import fs from 'node:fs';
import path from 'node:path';
import bigInt from 'big-integer';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import type { Api } from 'telegram';
import { config, hasCredentials } from './config';
import * as db from './db';
import { broadcast } from './ws';
import type { ChannelInfo, ScanProgress, TelegramStatus } from '../shared/types';

type TgMessage = Api.Message;

/**
 * How often to re-sweep monitored channels as a safety net (ms). Live
 * NewMessage updates arrive over a single long-lived connection that can
 * silently drop and reconnect (network blips, DC handoffs, sleep/wake) —
 * Telegram does not replay updates broadcast while a client was
 * disconnected, so a message posted during one of those gaps would
 * otherwise never be downloaded until someone manually re-scans. This
 * periodic re-scan (cheap: it only looks since each channel's watermark)
 * closes that gap automatically.
 */
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How often to verify the connection is actually alive, not just marked
 * "connected" (ms). GramJS has its own internal ping/reconnect loop, but a
 * socket left over a laptop sleep can end up "zombied" — neither cleanly
 * closed nor actually able to send/receive — in a way that doesn't always
 * trigger GramJS's own recovery promptly. This is a cheap, unrelated-to-
 * downloads probe (plain getMe()), separate from the file-sweep reconcile
 * loop, so a legitimately slow large-file download is never mistaken for a
 * dead connection.
 */
const HEALTH_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const HEALTH_CHECK_TIMEOUT_MS = 10 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

class TelegramService {
  private client: TelegramClient | null = null;
  private _status: TelegramStatus = 'no_credentials';
  private userName: string | undefined;
  /** Guards against the same file being downloaded concurrently in-process. */
  private inFlight = new Set<string>();
  private reconcileTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private checkingHealth = false;
  private restarting = false;

  get status(): TelegramStatus {
    return this._status;
  }

  get user(): string | undefined {
    return this.userName;
  }

  private setStatus(s: TelegramStatus): void {
    if (this._status !== s) {
      this._status = s;
      broadcast({ type: 'telegram_status', status: s });
    }
  }

  async start(): Promise<void> {
    if (!hasCredentials()) {
      this.setStatus('no_credentials');
      console.log('[telegram] TELEGRAM_API_ID / TELEGRAM_API_HASH not set — see README.');
      return;
    }
    const sessionStr = db.getSetting('tg_session');
    if (!sessionStr) {
      this.setStatus('not_logged_in');
      console.log('[telegram] No session found. Run `npm run login` to sign in.');
      return;
    }

    this.setStatus('connecting');
    try {
      this.client = new TelegramClient(new StringSession(sessionStr), config.apiId, config.apiHash, {
        connectionRetries: 10,
        autoReconnect: true,
        // TLS WebSocket on 443: looks like ordinary HTTPS, so it survives
        // networks that filter/kill raw MTProto TCP traffic.
        useWSS: true,
      });
      // Must patch before connect(): GramJS binds its reconnect callback to
      // whatever _handleReconnect resolves to at that moment
      // (`this._handleReconnect.bind(this)`, called once inside connect()).
      // JS's .bind() captures the function reference at bind-time, so
      // patching afterwards — even on the same instance — would silently
      // have no effect; verified empirically against the installed version.
      this.hookReconnect();
      await this.client.connect();
      if (!(await this.client.isUserAuthorized())) {
        console.log('[telegram] Session is no longer valid. Run `npm run login` again.');
        await this.client.disconnect();
        this.client = null;
        this.setStatus('not_logged_in');
        return;
      }
      const me = await this.client.getMe();
      this.userName = me.username ? `@${me.username}` : [me.firstName, me.lastName].filter(Boolean).join(' ');
      this.client.addEventHandler((e) => void this.onNewMessage(e), new NewMessage({}));
      this.setStatus('connected');
      console.log(`[telegram] Connected as ${this.userName}`);

      // Fire-and-forget recovery work; live monitoring is already active.
      void this.retryIncomplete().catch((err) =>
        console.error('[telegram] retryIncomplete failed:', err)
      );
      // Catch up on anything posted while offline — same instant sweep a
      // reconnect triggers, since a fresh boot is architecturally the same
      // situation (was disconnected, now connected).
      void this.catchUpAll().catch((err) => console.error('[telegram] catch-up failed:', err));
      this.startReconcileLoop();
      this.startHealthCheckLoop();
    } catch (err) {
      console.error('[telegram] Failed to start:', err);
      this.setStatus('error');
    }
  }

  /**
   * Tears down and reconnects from scratch. Used when a health check finds
   * the connection unresponsive — a full restart rather than trying to
   * reason about GramJS's internal state, since after something like a
   * laptop sleep that state can be inconsistent in ways not worth chasing.
   */
  private async restart(): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;
    console.log('[telegram] Restarting the Telegram connection...');
    const oldClient = this.client;
    this.client = null;
    this.setStatus('connecting');
    if (oldClient) {
      try {
        // destroy(), not disconnect(): GramJS's background _updateLoop only
        // exits once client._destroyed is true, which only destroy() sets.
        // disconnect() alone leaves that loop running forever on the old,
        // abandoned client — an orphaned zombie retrying pings indefinitely,
        // completely independent of the new client created below. Confirmed
        // by reproducing this exact leak from a real production log.
        await withTimeout(oldClient.destroy(), 5000);
      } catch {
        /* best-effort teardown of a possibly-wedged connection */
      }
    }
    try {
      await this.start();
    } finally {
      this.restarting = false;
    }
  }

  /**
   * Periodically confirms the connection can actually complete a round trip
   * — GramJS reporting "connected" isn't proof of that, as shown by testing:
   * forcibly killing the underlying socket did not flip the client's own
   * `connected` getter to false even once, across many polls, despite the
   * connection genuinely being dead in between. A cheap getMe() call with a
   * short timeout is a much more direct test of real liveness.
   */
  private startHealthCheckLoop(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => this.checkHealth(), HEALTH_CHECK_INTERVAL_MS);
    this.healthTimer.unref?.();
  }

  private async checkHealth(): Promise<void> {
    if (this.checkingHealth || this.restarting) return;

    // A previous (re)connect attempt can fail outright — e.g. the network
    // was still down at that exact moment (sleep/wake Wi-Fi reassociation,
    // a real outage) — landing the client in 'error' with nothing left to
    // retry it. Without this, that's permanent: the app sits broken until
    // someone manually restarts it, which is the failure this whole health
    // check exists to avoid. Keep retrying on the same cadence until the
    // network comes back, rather than giving up after one attempt.
    if (this._status === 'error') {
      console.log('[telegram] Retrying connection after a previous failed attempt...');
      void this.restart();
      return;
    }

    if (this._status !== 'connected' || !this.client) return;
    this.checkingHealth = true;
    try {
      await withTimeout(this.client.getMe(), HEALTH_CHECK_TIMEOUT_MS);
    } catch (err) {
      console.error('[telegram] Health check failed — connection appears stuck:', err);
      void this.restart();
    } finally {
      this.checkingHealth = false;
    }
  }

  /**
   * Backstop: periodically re-sweeps monitored channels since their
   * watermark so a message missed during a brief live-connection drop still
   * gets picked up eventually, even if the reconnect hook below never fires
   * (e.g. a future GramJS version renames/removes the internal method it
   * relies on) or the process was suspended (laptop sleep) in a way that
   * skips a clean reconnect sequence.
   */
  private startReconcileLoop(): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setInterval(() => this.reconcile('periodic'), RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.(); // don't hold the process open just for this
  }

  /**
   * Best-effort: react the moment GramJS's main sender reconnects after a
   * drop, instead of waiting for the next periodic sweep — this is what
   * actually minimizes how long a message can sit undownloaded after a
   * network blip. There is no public API for this, so it monkey-patches
   * TelegramClient's internal `_handleReconnect` — verified empirically
   * (against the installed "telegram" package version) with a forced-socket-
   * kill test: it's the autoReconnectCallback wired specifically to the
   * main/home-DC sender that carries updates, not the separate per-download
   * media connections, and it fires within ~1s of a real reconnect.
   *
   * This must patch the PROTOTYPE, and before the first connect() call:
   * GramJS does `this._handleReconnect.bind(this)` exactly once, inside
   * connect(), to build the callback it hands to the sender. JS's .bind()
   * captures whatever function `this._handleReconnect` resolves to at that
   * exact moment — patching the instance property afterwards (even
   * immediately after connect() resolves) has no effect, since the sender
   * already holds a bound reference to the original method. Patching the
   * prototype before connect() ever runs means that first lookup resolves
   * to our override instead — this was confirmed empirically; an
   * instance-level patch applied post-connect was confirmed NOT to fire.
   *
   * If a future GramJS version renames or removes the method, this silently
   * no-ops and the app simply falls back to the periodic loop below — it
   * does not break anything if the hook stops working.
   */
  private static reconnectHookInstalled = false;
  private hookReconnect(): void {
    if (TelegramService.reconnectHookInstalled) return;
    const proto = TelegramClient.prototype as unknown as {
      _handleReconnect?: (this: TelegramClient) => Promise<void>;
    };
    if (typeof proto._handleReconnect !== 'function') {
      console.log('[telegram] Reconnect hook unavailable in this GramJS version — relying on the periodic sweep only.');
      return;
    }
    TelegramService.reconnectHookInstalled = true;
    const original = proto._handleReconnect;
    const service = this;
    proto._handleReconnect = async function (this: TelegramClient) {
      await original.call(this);
      console.log('[telegram] Reconnected — running an immediate reconcile sweep');
      service.reconcile('reconnect');
    };
    console.log('[telegram] Reconnect hook attached — reconnects will trigger an immediate reconcile sweep.');
  }

  /** Shared by both reconcile triggers; avoids overlapping sweeps. */
  private reconciling = false;
  private reconcile(reason: 'periodic' | 'reconnect'): void {
    if (this.reconciling || this._status !== 'connected') return;
    this.reconciling = true;
    void this.catchUpAll()
      .catch((err) => console.error(`[telegram] reconcile sweep (${reason}) failed:`, err))
      .finally(() => {
        this.reconciling = false;
      });
  }

  private requireClient(): TelegramClient {
    if (!this.client || this._status !== 'connected') {
      throw new Error('Telegram is not connected');
    }
    return this.client;
  }

  // ---------- channel listing ----------

  async listChannels(): Promise<ChannelInfo[]> {
    const client = this.requireClient();
    const dialogs = await client.getDialogs({});
    const channels: ChannelInfo[] = [];
    for (const d of dialogs) {
      if (!d.isChannel || !d.id) continue;
      const entity = d.entity as Api.Channel;
      const info = {
        id: d.id.toString(),
        title: d.title ?? entity.title ?? 'Untitled',
        username: entity.username ?? undefined,
        isMegagroup: entity.megagroup === true,
      };
      db.upsertChannel(info);
      channels.push({ ...info, monitored: db.isChannelMonitored(info.id) });
    }
    return channels;
  }

  /**
   * Called when monitoring is enabled: records the channel's current latest
   * message id as the catch-up baseline, so a later catch-up scan only looks
   * at messages that arrived after this point.
   */
  async setMonitorBaseline(channelId: string): Promise<void> {
    if (!this.client || this._status !== 'connected') return;
    try {
      const entity = await this.client.getEntity(bigInt(channelId));
      const [latest] = await this.client.getMessages(entity, { limit: 1 });
      if (latest) db.bumpLastMessageId(channelId, latest.id);
    } catch (err) {
      console.error(`[telegram] Could not set baseline for ${channelId}:`, err);
    }
  }

  // ---------- live monitoring ----------

  private async onNewMessage(event: NewMessageEvent): Promise<void> {
    try {
      const chatId = event.chatId?.toString();
      if (!chatId || !db.isChannelMonitored(chatId)) return;
      db.bumpLastMessageId(chatId, event.message.id);
      await this.processMessage(chatId, event.message);
    } catch (err) {
      console.error('[telegram] Error handling new message:', err);
    }
  }

  // ---------- scanning ----------

  /**
   * Sweep recent, still-undeleted messages of a channel for matching files.
   * `silent` skips the scan_progress WS broadcasts — used for automatic
   * background sweeps (boot-time catch-up, periodic reconcile) so the
   * Channels page doesn't display a permanent "Scanned N messages" line for
   * scans the user never asked to see. Manual scans (Channels page "Scan"
   * button, "Scan all") still show live progress. Matching files are
   * downloaded and notified either way.
   */
  async scanChannel(
    channelId: string,
    opts: { sinceId?: number; limit?: number; silent?: boolean } = {}
  ): Promise<ScanProgress> {
    const client = this.requireClient();
    const channelRow = db.getChannel(channelId);
    const channelTitle = channelRow?.title ?? channelId;
    const progress: ScanProgress = { channelId, channelTitle, scanned: 0, matched: 0, done: false };

    try {
      const entity = await client.getEntity(bigInt(channelId));
      const iterOpts: { minId?: number; limit: number } = { limit: opts.limit ?? 1000 };
      if (opts.sinceId) iterOpts.minId = opts.sinceId;

      let maxId = 0;
      for await (const message of client.iterMessages(entity, iterOpts)) {
        progress.scanned++;
        if (message.id > maxId) maxId = message.id;
        const matched = await this.processMessage(channelId, message as TgMessage);
        if (matched) progress.matched++;
        if (!opts.silent && progress.scanned % 50 === 0) {
          broadcast({ type: 'scan_progress', progress: { ...progress } });
        }
      }
      if (maxId > 0) db.bumpLastMessageId(channelId, maxId);
      progress.done = true;
    } catch (err) {
      progress.done = true;
      progress.error = err instanceof Error ? err.message : String(err);
      console.error(`[telegram] Scan of ${channelTitle} failed:`, err);
    }
    if (!opts.silent) broadcast({ type: 'scan_progress', progress });
    return progress;
  }

  /**
   * Scan monitored channels since their watermark — used both for the
   * one-off catch-up after downtime and for the periodic reconcile loop.
   * Silent when there's nothing to report, so the recurring reconcile sweep
   * doesn't spam the log every few minutes.
   */
  async catchUpAll(): Promise<void> {
    for (const ch of db.getMonitoredChannels()) {
      // No watermark means monitoring was enabled while offline and the user
      // never scanned — only monitor forward from here rather than pull history.
      if (ch.last_message_id == null) {
        await this.setMonitorBaseline(ch.id);
        continue;
      }
      const progress = await this.scanChannel(ch.id, { sinceId: ch.last_message_id, silent: true });
      if (progress.scanned > 0) {
        console.log(
          `[telegram] Catch-up scan: ${ch.title} — ${progress.scanned} message(s) since watermark, ${progress.matched} matched`
        );
      }
    }
  }

  /** Retry ledger rows that never completed (e.g. crash mid-download). */
  private async retryIncomplete(): Promise<void> {
    const rows = db.getIncompleteDownloads();
    if (rows.length === 0) return;
    console.log(`[telegram] Retrying ${rows.length} incomplete download(s)...`);
    const client = this.requireClient();
    for (const row of rows) {
      try {
        const entity = await client.getEntity(bigInt(row.channel_id));
        const [message] = await client.getMessages(entity, { ids: [row.message_id] });
        if (!message || !message.document) {
          db.markDownloadFailed(row.id, 'Message was deleted before the download finished');
          continue;
        }
        db.resetDownloadForRetry(row.id);
        await this.downloadDocument(row, message as TgMessage);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        db.markDownloadFailed(row.id, msg);
        console.error(`[telegram] Retry of "${row.filename}" failed:`, msg);
      }
    }
  }

  // ---------- matching + downloading ----------

  /**
   * Inspect one message; if it carries a document whose filename matches a
   * keyword rule and it isn't in the ledger yet, download it.
   * Returns true if the message matched (regardless of dedup outcome).
   */
  private async processMessage(channelId: string, message: TgMessage): Promise<boolean> {
    const doc = message.document;
    if (!doc) return false;
    const filename = message.file?.name;
    if (!filename) return false;

    const matchedKeyword = matchKeyword(filename);
    if (!matchedKeyword) return false;

    const documentId = doc.id.toString();
    const dedupKey = `${channelId}:${message.id}:${documentId}`;
    const existing = db.getDownload(channelId, message.id, documentId);
    if (existing?.status === 'complete') return true; // already downloaded — never twice
    if (this.inFlight.has(dedupKey)) return true;

    const channelTitle = db.getChannel(channelId)?.title ?? channelId;
    const size = message.file?.size ? Number(message.file.size) : null;

    let row: db.DownloadRow;
    if (existing) {
      db.resetDownloadForRetry(existing.id);
      row = existing;
    } else {
      row = db.insertPendingDownload({
        channelId,
        messageId: message.id,
        documentId,
        filename,
        channelTitle,
        matchedKeyword,
        size,
        // message.date is a Unix timestamp in seconds (Telegram convention).
        sentAt: message.date ? new Date(message.date * 1000).toISOString() : null,
      });
    }

    this.inFlight.add(dedupKey);
    try {
      await this.downloadDocument(row, message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      db.markDownloadFailed(row.id, msg);
      broadcast({ type: 'download_failed', filename, channelTitle, error: msg });
      console.error(`[telegram] Download of "${filename}" failed:`, msg);
    } finally {
      this.inFlight.delete(dedupKey);
    }
    return true;
  }

  /**
   * Crash-safe download: write to a .part temp file, rename into place, and
   * only then mark the ledger row complete.
   */
  private async downloadDocument(row: db.DownloadRow, message: TgMessage): Promise<void> {
    const client = this.requireClient();
    const dir = db.getDownloadDir();
    fs.mkdirSync(dir, { recursive: true });

    const safeName = sanitizeFilename(row.filename);
    // Avoid clobbering a different file that happens to share the name.
    const finalName = db.filenameTakenByOther(safeName, row.id)
      ? withSuffix(safeName, row.id)
      : safeName;
    const finalPath = path.join(dir, finalName);
    const partPath = `${finalPath}.part`;

    broadcast({ type: 'download_started', filename: finalName, channelTitle: row.channel_title });
    console.log(`[telegram] Downloading "${finalName}" from ${row.channel_title}...`);

    let lastProgressAt = 0;
    await client.downloadMedia(message, {
      outputFile: partPath,
      progressCallback: (received, total) => {
        const now = Date.now();
        if (now - lastProgressAt < 500) return; // throttle WS traffic
        lastProgressAt = now;
        broadcast({
          type: 'download_progress',
          filename: finalName,
          channelTitle: row.channel_title,
          received: Number(received),
          total: Number(total),
        });
      },
    });

    fs.renameSync(partPath, finalPath);
    const size = fs.statSync(finalPath).size;
    db.markDownloadComplete(row.id, finalName, size);

    const notification = db.addNotification(row.id, finalName, row.channel_title);
    broadcast({
      type: 'download_complete',
      filename: finalName,
      channelTitle: row.channel_title,
      size,
      notification,
    });
    console.log(`[telegram] Saved "${finalName}" (${size} bytes)`);
  }
}

// ---------- helpers ----------

export function matchKeyword(filename: string): string | undefined {
  const lower = filename.toLowerCase();
  for (const rule of db.listKeywords()) {
    // A multi-word keyword matches when every word appears in the filename,
    // in any order; a single-word keyword is a plain substring match.
    const words = rule.keyword.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length > 0 && words.every((w) => lower.includes(w))) return rule.keyword;
  }
  return undefined;
}

function sanitizeFilename(name: string): string {
  const cleaned = path
    .basename(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'unnamed';
}

function withSuffix(name: string, id: number): string {
  const ext = path.extname(name);
  return `${name.slice(0, name.length - ext.length)} (${id})${ext}`;
}

export const telegram = new TelegramService();
