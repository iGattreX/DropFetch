import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import type { KeywordRule, NotificationItem } from '../shared/types';

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(path.join(config.dataDir, 'dropfetch.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  username        TEXT,
  is_megagroup    INTEGER NOT NULL DEFAULT 0,
  monitored       INTEGER NOT NULL DEFAULT 0,
  last_message_id INTEGER
);

CREATE TABLE IF NOT EXISTS keywords (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword    TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS downloads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id      TEXT NOT NULL,
  message_id      INTEGER NOT NULL,
  document_id     TEXT NOT NULL,
  filename        TEXT NOT NULL,
  channel_title   TEXT NOT NULL DEFAULT '',
  matched_keyword TEXT,
  size            INTEGER,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | complete | failed
  error           TEXT,
  sent_at         TEXT, -- when the message was posted in Telegram (from message.date)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at    TEXT,
  UNIQUE(channel_id, message_id, document_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  download_id   INTEGER REFERENCES downloads(id) ON DELETE SET NULL,
  filename      TEXT NOT NULL,
  channel_title TEXT NOT NULL DEFAULT '',
  read          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

// Migration: existing DBs created before sent_at was added need the column
// retrofitted — CREATE TABLE IF NOT EXISTS above only applies to fresh DBs.
const downloadsColumns = db.prepare('PRAGMA table_info(downloads)').all() as { name: string }[];
if (!downloadsColumns.some((c) => c.name === 'sent_at')) {
  db.exec('ALTER TABLE downloads ADD COLUMN sent_at TEXT');
}

// ---------- settings ----------

// Seed defaults so every preference has an explicit stored value.
const DEFAULT_SETTINGS: Record<string, string> = {
  notification_sound: 'knock',
  theme_mode: 'system',
  accent_color: 'teal',
  layout_mode: 'single',
  layout_columns: 'files,channels',
  tunnel_enabled: 'false',
};

const seedStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
);
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  seedStmt.run(key, value);
}
// The remote-access token is random per install, so it can't be a static default.
seedStmt.run('access_token', crypto.randomBytes(24).toString('base64url'));

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function getDownloadDir(): string {
  return getSetting('download_dir') ?? config.defaultDownloadDir;
}

// ---------- channels ----------

export interface ChannelRow {
  id: string;
  title: string;
  username: string | null;
  is_megagroup: number;
  monitored: number;
  last_message_id: number | null;
}

export function upsertChannel(c: {
  id: string;
  title: string;
  username?: string;
  isMegagroup: boolean;
}): void {
  db.prepare(
    `INSERT INTO channels (id, title, username, is_megagroup) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, username = excluded.username, is_megagroup = excluded.is_megagroup`
  ).run(c.id, c.title, c.username ?? null, c.isMegagroup ? 1 : 0);
}

export function getChannel(id: string): ChannelRow | undefined {
  return db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
}

export function getMonitoredChannels(): ChannelRow[] {
  return db.prepare('SELECT * FROM channels WHERE monitored = 1').all() as ChannelRow[];
}

export function setChannelMonitored(id: string, monitored: boolean): void {
  db.prepare('UPDATE channels SET monitored = ? WHERE id = ?').run(monitored ? 1 : 0, id);
}

export function isChannelMonitored(id: string): boolean {
  const row = db.prepare('SELECT monitored FROM channels WHERE id = ?').get(id) as
    | { monitored: number }
    | undefined;
  return row?.monitored === 1;
}

/** Advance the catch-up watermark (never moves backwards). */
export function bumpLastMessageId(id: string, messageId: number): void {
  db.prepare(
    'UPDATE channels SET last_message_id = MAX(COALESCE(last_message_id, 0), ?) WHERE id = ?'
  ).run(messageId, id);
}

// ---------- keywords ----------

export function listKeywords(): KeywordRule[] {
  const rows = db
    .prepare('SELECT id, keyword, created_at FROM keywords ORDER BY created_at DESC')
    .all() as { id: number; keyword: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, keyword: r.keyword, createdAt: r.created_at }));
}

export function addKeyword(keyword: string): KeywordRule | undefined {
  const trimmed = keyword.trim();
  if (!trimmed) return undefined;
  const info = db
    .prepare('INSERT INTO keywords (keyword) VALUES (?) ON CONFLICT(keyword) DO NOTHING')
    .run(trimmed);
  if (info.changes === 0) return undefined;
  const row = db
    .prepare('SELECT id, keyword, created_at FROM keywords WHERE id = ?')
    .get(info.lastInsertRowid) as { id: number; keyword: string; created_at: string };
  return { id: row.id, keyword: row.keyword, createdAt: row.created_at };
}

export function removeKeyword(id: number): void {
  db.prepare('DELETE FROM keywords WHERE id = ?').run(id);
}

// ---------- downloads (dedup ledger) ----------

export interface DownloadRow {
  id: number;
  channel_id: string;
  message_id: number;
  document_id: string;
  filename: string;
  channel_title: string;
  matched_keyword: string | null;
  size: number | null;
  status: 'pending' | 'complete' | 'failed';
  error: string | null;
  sent_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export function getDownload(
  channelId: string,
  messageId: number,
  documentId: string
): DownloadRow | undefined {
  return db
    .prepare('SELECT * FROM downloads WHERE channel_id = ? AND message_id = ? AND document_id = ?')
    .get(channelId, messageId, documentId) as DownloadRow | undefined;
}

export function insertPendingDownload(d: {
  channelId: string;
  messageId: number;
  documentId: string;
  filename: string;
  channelTitle: string;
  matchedKeyword: string;
  size: number | null;
  sentAt: string | null;
}): DownloadRow {
  const info = db
    .prepare(
      `INSERT INTO downloads (channel_id, message_id, document_id, filename, channel_title, matched_keyword, size, sent_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      d.channelId,
      d.messageId,
      d.documentId,
      d.filename,
      d.channelTitle,
      d.matchedKeyword,
      d.size,
      d.sentAt
    );
  return db.prepare('SELECT * FROM downloads WHERE id = ?').get(info.lastInsertRowid) as DownloadRow;
}

/** Reset a pending/failed row for a retry attempt. */
export function resetDownloadForRetry(id: number): void {
  db.prepare("UPDATE downloads SET status = 'pending', error = NULL WHERE id = ?").run(id);
}

export function markDownloadComplete(id: number, finalFilename: string, size: number): void {
  db.prepare(
    `UPDATE downloads SET status = 'complete', filename = ?, size = ?, error = NULL,
     completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(finalFilename, size, id);
}

export function markDownloadFailed(id: number, error: string): void {
  db.prepare("UPDATE downloads SET status = 'failed', error = ? WHERE id = ?").run(error, id);
}

export function getIncompleteDownloads(): DownloadRow[] {
  return db
    .prepare("SELECT * FROM downloads WHERE status IN ('pending', 'failed')")
    .all() as DownloadRow[];
}

export function getCompletedDownloads(): DownloadRow[] {
  return db
    .prepare("SELECT * FROM downloads WHERE status = 'complete' ORDER BY completed_at DESC")
    .all() as DownloadRow[];
}

/** True if some OTHER completed download already claims this filename. */
export function filenameTakenByOther(filename: string, excludeId: number): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM downloads WHERE filename = ? COLLATE NOCASE AND status = 'complete' AND id != ? LIMIT 1"
    )
    .get(filename, excludeId);
  return row !== undefined;
}

// ---------- notifications ----------

function toNotificationItem(r: {
  id: number;
  filename: string;
  channel_title: string;
  read: number;
  created_at: string;
}): NotificationItem {
  return {
    id: r.id,
    filename: r.filename,
    channelTitle: r.channel_title,
    read: r.read === 1,
    createdAt: r.created_at,
  };
}

export function addNotification(
  downloadId: number,
  filename: string,
  channelTitle: string
): NotificationItem {
  const info = db
    .prepare('INSERT INTO notifications (download_id, filename, channel_title) VALUES (?, ?, ?)')
    .run(downloadId, filename, channelTitle);
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid) as any;
  return toNotificationItem(row);
}

export function listNotifications(limit = 100): NotificationItem[] {
  const rows = db
    .prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?')
    .all(limit) as any[];
  return rows.map(toNotificationItem);
}

export function markNotificationRead(id: number): number {
  return db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND read = 0').run(id).changes;
}

export function markAllNotificationsRead(): number {
  return db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run().changes;
}

/** Mark any unread notifications for this filename read (file was opened). */
export function markNotificationsReadByFilename(filename: string): number {
  return db
    .prepare('UPDATE notifications SET read = 1 WHERE filename = ? AND read = 0')
    .run(filename).changes;
}

/** Latest notification (id + read state) for a completed download, if any. */
export function getNotificationStateForDownload(
  downloadId: number
): { id: number; read: boolean } | undefined {
  const row = db
    .prepare('SELECT id, read FROM notifications WHERE download_id = ? ORDER BY id DESC LIMIT 1')
    .get(downloadId) as { id: number; read: number } | undefined;
  return row ? { id: row.id, read: row.read === 1 } : undefined;
}

export default db;
