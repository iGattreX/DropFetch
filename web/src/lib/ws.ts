import type { WsEvent } from '@shared/types';
import {
  channelsVersion,
  filesVersion,
  keywordsVersion,
  loadNotifications,
  pushNotification,
  scanProgress,
  settingsVersion,
  showToast,
  tgStatus,
  tunnelInfo,
} from './stores';
import { notificationSound } from './sound';
import { themeMode, accentId } from './theme';
import { layoutMode, layoutColumns } from './layout';
import { api } from './api';

let socket: WebSocket | null = null;
let retryDelay = 1000;

export function connectWs(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);

  socket.onopen = () => {
    retryDelay = 1000;
  };

  socket.onmessage = (msg) => {
    let event: WsEvent;
    try {
      event = JSON.parse(msg.data);
    } catch {
      return;
    }
    handleEvent(event);
  };

  socket.onclose = () => {
    socket = null;
    setTimeout(connectWs, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  };
}

function handleEvent(event: WsEvent): void {
  switch (event.type) {
    case 'telegram_status':
      tgStatus.set(event.status);
      break;

    case 'tunnel_status':
      tunnelInfo.set(event.tunnel);
      break;

    // Another session (or this one) changed state — refetch the affected slice
    // so every open tab/device converges instantly.
    case 'state_changed':
      switch (event.scope) {
        case 'notifications':
          void loadNotifications();
          filesVersion.update((v) => v + 1); // unread badges live in the file list
          break;
        case 'files':
          filesVersion.update((v) => v + 1);
          break;
        case 'keywords':
          keywordsVersion.update((v) => v + 1);
          break;
        case 'channels':
          channelsVersion.update((v) => v + 1);
          break;
        case 'settings':
          void (async () => {
            try {
              const s = await api.settings();
              themeMode.set(s.themeMode);
              accentId.set(s.accentColor);
              notificationSound.set(s.notificationSound);
              layoutMode.set(s.layoutMode);
              layoutColumns.set(s.layoutColumns);
              settingsVersion.update((v) => v + 1);
            } catch {
              /* backend unreachable; next event will retry */
            }
          })();
          break;
      }
      break;

    case 'download_complete':
      pushNotification(event.notification);
      filesVersion.update((v) => v + 1);
      // showToast plays the notification sound itself.
      showToast({
        kind: 'success',
        title: 'File downloaded',
        body: event.channelTitle,
        filename: event.filename,
      });
      break;

    case 'download_failed':
      showToast({
        kind: 'error',
        title: 'Download failed',
        body: `${event.filename}: ${event.error}`,
      });
      break;

    case 'scan_progress':
      scanProgress.update((map) => ({ ...map, [event.progress.channelId]: event.progress }));
      if (event.progress.done && !event.progress.error) {
        filesVersion.update((v) => v + 1);
      }
      if (event.progress.done && event.progress.error) {
        showToast({
          kind: 'error',
          title: `Scan of ${event.progress.channelTitle} failed`,
          body: event.progress.error,
        });
      }
      break;

    case 'download_started':
    case 'download_progress':
      // Progress is intentionally low-key; the completion toast is the signal.
      break;
  }
}
