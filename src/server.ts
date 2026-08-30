import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import mime from 'mime-types';
import { config, hasCredentials } from './config';
import * as db from './db';
import { telegram } from './telegram';
import { tunnel } from './tunnel';
import { addClient, broadcast } from './ws';
import type {
  AppSettings,
  ChannelInfo,
  FileEntry,
  StatusResponse,
} from '../shared/types';

export async function buildServer() {
  const app = Fastify({ logger: false });

  // ---------- access control ----------
  // Local/LAN requests are trusted. Requests arriving through the Cloudflare
  // tunnel (identified by the cf-connecting-ip header the edge adds) must
  // present the access token — via the QR link (?token=…), the cookie that
  // link sets, or an Authorization: Bearer header.
  app.addHook('onRequest', async (req, reply) => {
    const token = db.getSetting('access_token');
    if (!token) return;

    const queryToken = (req.query as Record<string, unknown> | undefined)?.token;
    if (typeof queryToken === 'string' && safeEqual(queryToken, token)) {
      reply.header('set-cookie', tokenCookie(token));
      return;
    }
    const cookieToken = parseCookies(req.headers.cookie).df_token;
    if (cookieToken && safeEqual(cookieToken, token)) return;

    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ') && safeEqual(auth.slice(7), token)) return;

    if (!req.headers['cf-connecting-ip']) return; // local / LAN

    return reply
      .code(401)
      .send({ error: 'Access token required. Open the link from the QR code in Settings.' });
  });

  await app.register(fastifyWebsocket);

  app.get('/ws', { websocket: true }, (socket) => {
    addClient(socket);
    socket.send(JSON.stringify({ type: 'telegram_status', status: telegram.status }));
  });

  // ---------- status & settings ----------

  app.get('/api/status', async (): Promise<StatusResponse> => ({
    telegram: telegram.status,
    telegramUser: telegram.user,
    hasCredentials: hasCredentials(),
    settings: currentSettings(),
  }));

  app.get('/api/settings', async (): Promise<AppSettings> => currentSettings());

  app.put('/api/settings', async (req, reply) => {
    const body = req.body as Partial<AppSettings>;
    if (typeof body.downloadDir === 'string' && body.downloadDir.trim()) {
      const dir = path.resolve(body.downloadDir.trim());
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        return reply.code(400).send({ error: `Cannot create folder: ${(err as Error).message}` });
      }
      db.setSetting('download_dir', dir);
    }
    if (typeof body.notificationSound === 'string' && body.notificationSound.trim()) {
      db.setSetting('notification_sound', body.notificationSound.trim().slice(0, 32));
    }
    if (body.themeMode === 'system' || body.themeMode === 'light' || body.themeMode === 'dark') {
      db.setSetting('theme_mode', body.themeMode);
    }
    if (typeof body.accentColor === 'string' && /^[a-z][a-z-]{0,19}$/.test(body.accentColor)) {
      db.setSetting('accent_color', body.accentColor);
    }
    if (body.layoutMode === 'single' || body.layoutMode === 'two' || body.layoutMode === 'three') {
      db.setSetting('layout_mode', body.layoutMode);
    }
    if (Array.isArray(body.layoutColumns)) {
      const valid = ['files', 'channels', 'keywords'];
      // Body is untrusted; validate the raw values before persisting.
      const cols = (body.layoutColumns as unknown[]).filter(
        (c): c is string => typeof c === 'string' && valid.includes(c)
      );
      if (cols.length === 2 && cols[0] !== cols[1]) {
        db.setSetting('layout_columns', cols.join(','));
      }
    }
    broadcast({ type: 'state_changed', scope: 'settings' });
    return currentSettings();
  });

  // ---------- channels ----------

  app.get('/api/channels', async (_req, reply) => {
    try {
      const channels: ChannelInfo[] = await telegram.listChannels();
      return channels;
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });

  app.post('/api/channels/:id/monitor', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { monitored } = req.body as { monitored: boolean };
    if (!db.getChannel(id)) return reply.code(404).send({ error: 'Unknown channel' });
    db.setChannelMonitored(id, monitored);
    if (monitored) {
      // Record "now" as the baseline so catch-up scans don't dig into history
      // the user never asked for. An explicit scan can still fetch it.
      void telegram.setMonitorBaseline(id);
    }
    broadcast({ type: 'state_changed', scope: 'channels' });
    return { ok: true };
  });

  app.post('/api/channels/:id/scan', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!db.getChannel(id)) return reply.code(404).send({ error: 'Unknown channel' });
    if (telegram.status !== 'connected') {
      return reply.code(503).send({ error: 'Telegram is not connected' });
    }
    // Run async; progress is streamed over the WebSocket.
    void telegram.scanChannel(id).catch((err) => console.error('[scan] failed:', err));
    return { started: true };
  });

  app.post('/api/scan', async (_req, reply) => {
    if (telegram.status !== 'connected') {
      return reply.code(503).send({ error: 'Telegram is not connected' });
    }
    const monitored = db.getMonitoredChannels();
    for (const ch of monitored) {
      void telegram.scanChannel(ch.id).catch((err) => console.error('[scan] failed:', err));
    }
    return { started: true, channels: monitored.length };
  });

  // ---------- keywords ----------

  app.get('/api/keywords', async () => db.listKeywords());

  app.post('/api/keywords', async (req, reply) => {
    const { keyword } = req.body as { keyword: string };
    if (!keyword || !keyword.trim()) return reply.code(400).send({ error: 'Keyword is empty' });
    const rule = db.addKeyword(keyword);
    if (!rule) return reply.code(409).send({ error: 'Keyword already exists' });
    broadcast({ type: 'state_changed', scope: 'keywords' });
    return rule;
  });

  app.delete('/api/keywords/:id', async (req) => {
    const { id } = req.params as { id: string };
    db.removeKeyword(Number(id));
    broadcast({ type: 'state_changed', scope: 'keywords' });
    return { ok: true };
  });

  // ---------- files ----------

  app.get('/api/files', async (): Promise<FileEntry[]> => {
    const dir = db.getDownloadDir();
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const ledger = new Map(db.getCompletedDownloads().map((d) => [d.filename.toLowerCase(), d]));
    const entries: FileEntry[] = [];
    for (const name of names) {
      if (name.endsWith('.part')) continue; // in-progress downloads
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const row = ledger.get(name.toLowerCase());
      const notification = row ? db.getNotificationStateForDownload(row.id) : undefined;
      entries.push({
        name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        channelTitle: row?.channel_title,
        sentAt: row?.sent_at ?? undefined,
        downloadedAt: row?.completed_at ?? undefined,
        matchedKeyword: row?.matched_keyword ?? undefined,
        notificationId: notification?.id,
        unread: notification ? !notification.read : undefined,
      });
    }
    // Sort by when the message was sent in Telegram, not when it was
    // downloaded — those can differ (e.g. a catch-up sweep). Files that
    // predate sent-time tracking fall back to download time so they don't
    // land out of place.
    const sortKey = (f: FileEntry) => f.sentAt ?? f.downloadedAt ?? f.modifiedAt;
    entries.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    return entries;
  });

  // Serve a downloaded file inline so the browser opens it in the new tab.
  app.get('/files/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const dir = db.getDownloadDir();
    const resolved = path.resolve(dir, path.basename(name));
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
      return reply.code(400).send({ error: 'Invalid filename' });
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return reply.code(404).send({ error: 'File not found' });
    }
    // Opening a file counts as reading its notification, everywhere at once.
    if (db.markNotificationsReadByFilename(path.basename(resolved)) > 0) {
      broadcast({ type: 'state_changed', scope: 'notifications' });
    }
    const type = mime.lookup(resolved) || 'application/octet-stream';
    reply.header('Content-Type', type);
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(resolved))}"`);
    return reply.send(fs.createReadStream(resolved));
  });

  // ---------- remote access (Cloudflare tunnel) ----------

  app.get('/api/tunnel', async () => ({
    ...tunnel.info(),
    // Caller is already authorized (local or token-bearing), so returning the
    // token here is what lets the UI render the QR link.
    token: db.getSetting('access_token'),
  }));

  app.post('/api/tunnel', async (req) => {
    const { enabled } = req.body as { enabled: boolean };
    db.setSetting('tunnel_enabled', String(enabled === true));
    if (enabled === true) tunnel.start();
    else tunnel.stop();
    return tunnel.info();
  });

  app.post('/api/tunnel/rotate-token', async (_req, reply) => {
    const token = crypto.randomBytes(24).toString('base64url');
    db.setSetting('access_token', token);
    // Keep the current client authorized; everyone else needs the new QR.
    reply.header('set-cookie', tokenCookie(token));
    broadcast({ type: 'tunnel_status', tunnel: tunnel.info() });
    return { token };
  });

  // The QR/share link points here (not at "/") because "/" is the PWA's
  // cached app shell: the service worker intercepts navigations to it and
  // serves the cached page WITHOUT ever hitting the network, so a token in
  // the URL would never reach this server to be exchanged for a cookie.
  // "/api/*" has been excluded from that cache fallback since the first PWA
  // build, so a request here always reaches this handler — the onRequest
  // hook above has already validated the token and set the cookie by the
  // time we get here; we just send the browser on to the app.
  app.get('/api/auth', async (_req, reply) => reply.redirect('/'));

  // ---------- notifications ----------

  app.get('/api/notifications', async () => db.listNotifications());

  app.post('/api/notifications/:id/read', async (req) => {
    const { id } = req.params as { id: string };
    if (db.markNotificationRead(Number(id)) > 0) {
      broadcast({ type: 'state_changed', scope: 'notifications' });
    }
    return { ok: true };
  });

  app.post('/api/notifications/read-all', async () => {
    if (db.markAllNotificationsRead() > 0) {
      broadcast({ type: 'state_changed', scope: 'notifications' });
    }
    return { ok: true };
  });

  // ---------- frontend (built PWA) ----------

  if (fs.existsSync(config.webDist)) {
    // wildcard:true serves whatever is on disk at request time, so a frontend
    // rebuild (new hashed asset names) doesn't require a server restart.
    // Missing files fall through to the not-found handler below.
    await app.register(fastifyStatic, { root: config.webDist, wildcard: true });
    // SPA fallback for any non-API route.
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/files')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async () => ({
      dropfetch: 'Frontend not built yet. Run `npm run build:web`, or use the Vite dev server.',
    }));
  }

  return app;
}

function tokenCookie(token: string): string {
  // Not marked Secure: local access is plain http; tunnel traffic is TLS anyway.
  return `df_token=${token}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function currentSettings(): AppSettings {
  const themeMode = db.getSetting('theme_mode');
  const layoutMode = db.getSetting('layout_mode');
  const validSections = ['files', 'channels', 'keywords'] as const;
  const layoutColumns = (db.getSetting('layout_columns') ?? 'files,channels')
    .split(',')
    .filter((c): c is (typeof validSections)[number] =>
      (validSections as readonly string[]).includes(c)
    );
  return {
    downloadDir: db.getDownloadDir(),
    notificationSound: db.getSetting('notification_sound') ?? 'knock',
    themeMode: themeMode === 'light' || themeMode === 'dark' ? themeMode : 'system',
    accentColor: db.getSetting('accent_color') ?? 'teal',
    layoutMode: layoutMode === 'two' || layoutMode === 'three' ? layoutMode : 'single',
    layoutColumns: layoutColumns.length === 2 ? layoutColumns : ['files', 'channels'],
  };
}
