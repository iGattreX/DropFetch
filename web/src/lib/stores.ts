import { writable, derived } from 'svelte/store';
import type { NotificationItem, ScanProgress, TelegramStatus, TunnelInfo } from '@shared/types';
import { api } from './api';
import { playNotificationSound } from './sound';

export type Tab = 'files' | 'channels' | 'keywords' | 'alerts' | 'settings';

export const activeTab = writable<Tab>('files');

export const tgStatus = writable<TelegramStatus>('connecting');

// ---------- notifications ----------

export const notifications = writable<NotificationItem[]>([]);

export const unreadCount = derived(notifications, ($n) => $n.filter((n) => !n.read).length);

export async function loadNotifications(): Promise<void> {
  try {
    notifications.set(await api.notifications());
  } catch {
    /* backend not reachable yet */
  }
}

export function pushNotification(item: NotificationItem): void {
  notifications.update((list) => [item, ...list]);
}

export async function markRead(id: number): Promise<void> {
  notifications.update((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
  await api.markRead(id);
}

export async function markAllRead(): Promise<void> {
  notifications.update((list) => list.map((n) => ({ ...n, read: true })));
  await api.markAllRead();
}

// ---------- toasts ----------

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  body?: string;
  /** Set for download toasts so "Open" can open the file. */
  filename?: string;
}

export const toasts = writable<Toast[]>([]);
let toastSeq = 0;

export function showToast(t: Omit<Toast, 'id'>, timeoutMs = 6000): void {
  const toast: Toast = { ...t, id: ++toastSeq };
  toasts.update((list) => [...list, toast]);
  playNotificationSound(); // every toast is audible (respects the sound switch)
  setTimeout(() => dismissToast(toast.id), timeoutMs);
}

export function dismissToast(id: number): void {
  toasts.update((list) => list.filter((t) => t.id !== id));
}

// ---------- scans & files ----------

/** Latest scan progress per channel id. */
export const scanProgress = writable<Record<string, ScanProgress>>({});

/** Bumped whenever a download completes so the Files page can refresh. */
export const filesVersion = writable(0);

/** Bumped by WS state_changed events so open pages refetch (cross-session sync). */
export const keywordsVersion = writable(0);
export const channelsVersion = writable(0);
export const settingsVersion = writable(0);

/** Live Cloudflare-tunnel status pushed from the server. */
export const tunnelInfo = writable<TunnelInfo | null>(null);
