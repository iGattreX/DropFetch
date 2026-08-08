import type { WebSocket } from 'ws';
import type { WsEvent } from '../shared/types';

const clients = new Set<WebSocket>();

export function addClient(socket: WebSocket): void {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

export function broadcast(event: WsEvent): void {
  const payload = JSON.stringify(event);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}
