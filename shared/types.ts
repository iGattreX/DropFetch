// Shared types between the Node backend and the Svelte frontend.
// Backend imports via relative path, frontend via the `@shared` Vite alias.

export type TelegramStatus =
  | 'no_credentials' // TELEGRAM_API_ID / TELEGRAM_API_HASH missing
  | 'not_logged_in' // credentials present but no valid session (run `npm run login`)
  | 'connecting'
  | 'connected'
  | 'error';

export interface ChannelInfo {
  id: string; // marked peer id, e.g. "-1001234567890"
  title: string;
  username?: string;
  isMegagroup: boolean;
  monitored: boolean;
}

export interface KeywordRule {
  id: number;
  keyword: string;
  createdAt: string;
}

export interface FileEntry {
  name: string;
  size: number;
  modifiedAt: string; // ISO
  channelTitle?: string;
  /** When the message was posted in Telegram. Unknown for files downloaded before this was tracked. */
  sentAt?: string; // ISO
  downloadedAt?: string; // ISO
  matchedKeyword?: string;
  /** Id of the download notification for this file, if DropFetch fetched it. */
  notificationId?: number;
  /** True while the file's notification is unread. */
  unread?: boolean;
}

export interface NotificationItem {
  id: number;
  filename: string;
  channelTitle: string;
  createdAt: string; // ISO
  read: boolean;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export type LayoutMode = 'single' | 'two' | 'three';

/** Sections that can be shown as columns on desktop. */
export type SectionId = 'files' | 'channels' | 'keywords';

export interface AppSettings {
  downloadDir: string;
  /** Id of the notification sound (see web/src/lib/sound.ts for options). Default: 'knock'. */
  notificationSound: string;
  /** Default: 'system'. */
  themeMode: ThemeMode;
  /** Accent palette id (see web/src/lib/theme.ts for options). Default: 'teal'. */
  accentColor: string;
  /** Desktop layout. Default: 'single'. Mobile always uses single column. */
  layoutMode: LayoutMode;
  /** The two sections shown side-by-side in 'two' mode. Default: files+channels. */
  layoutColumns: SectionId[];
}

export interface StatusResponse {
  telegram: TelegramStatus;
  telegramUser?: string;
  hasCredentials: boolean;
  settings: AppSettings;
}

export interface ScanProgress {
  channelId: string;
  channelTitle: string;
  scanned: number;
  matched: number;
  done: boolean;
  error?: string;
}

export type TunnelState = 'stopped' | 'starting' | 'running' | 'error' | 'not_installed';

export interface TunnelInfo {
  /** Whether the user wants the tunnel on (persisted). */
  enabled: boolean;
  state: TunnelState;
  /** Public https://….trycloudflare.com URL when running. */
  url: string | null;
  error?: string;
}

/** Which slice of app state changed — clients refetch the matching data. */
export type StateScope = 'notifications' | 'keywords' | 'channels' | 'settings' | 'files';

export type WsEvent =
  | { type: 'state_changed'; scope: StateScope }
  | { type: 'tunnel_status'; tunnel: TunnelInfo }
  | { type: 'download_started'; filename: string; channelTitle: string }
  | {
      type: 'download_progress';
      filename: string;
      channelTitle: string;
      received: number;
      total: number;
    }
  | {
      type: 'download_complete';
      filename: string;
      channelTitle: string;
      size: number;
      notification: NotificationItem;
    }
  | { type: 'download_failed'; filename: string; channelTitle: string; error: string }
  | { type: 'scan_progress'; progress: ScanProgress }
  | { type: 'telegram_status'; status: TelegramStatus };
