import type {
  AppSettings,
  ChannelInfo,
  FileEntry,
  KeywordRule,
  NotificationItem,
  StatusResponse,
  TunnelInfo,
} from '@shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => request<StatusResponse>('/api/status'),

  settings: () => request<AppSettings>('/api/settings'),
  saveSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  channels: () => request<ChannelInfo[]>('/api/channels'),
  setMonitored: (id: string, monitored: boolean) =>
    request<{ ok: boolean }>(`/api/channels/${encodeURIComponent(id)}/monitor`, {
      method: 'POST',
      body: JSON.stringify({ monitored }),
    }),
  scanChannel: (id: string) =>
    request<{ started: boolean }>(`/api/channels/${encodeURIComponent(id)}/scan`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  scanAll: () =>
    request<{ started: boolean; channels: number }>('/api/scan', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  keywords: () => request<KeywordRule[]>('/api/keywords'),
  addKeyword: (keyword: string) =>
    request<KeywordRule>('/api/keywords', { method: 'POST', body: JSON.stringify({ keyword }) }),
  removeKeyword: (id: number) =>
    request<{ ok: boolean }>(`/api/keywords/${id}`, { method: 'DELETE', body: '{}' }),

  files: () => request<FileEntry[]>('/api/files'),

  tunnel: () => request<TunnelInfo & { token: string }>('/api/tunnel'),
  setTunnelEnabled: (enabled: boolean) =>
    request<TunnelInfo>('/api/tunnel', { method: 'POST', body: JSON.stringify({ enabled }) }),
  rotateToken: () =>
    request<{ token: string }>('/api/tunnel/rotate-token', { method: 'POST', body: '{}' }),

  notifications: () => request<NotificationItem[]>('/api/notifications'),
  markRead: (id: number) =>
    request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'POST', body: '{}' }),
  markAllRead: () =>
    request<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST', body: '{}' }),
};

export function fileUrl(name: string): string {
  return `/files/${encodeURIComponent(name)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
