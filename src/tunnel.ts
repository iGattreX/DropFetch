import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { config } from './config';
import * as db from './db';
import { broadcast } from './ws';
import type { TunnelInfo, TunnelState } from '../shared/types';

/**
 * Manages a Cloudflare "quick tunnel" (cloudflared) that exposes the local
 * server at a random https://….trycloudflare.com URL. No Cloudflare account
 * is required. The URL changes every time the tunnel restarts; the Settings
 * UI regenerates the QR code accordingly.
 */
class TunnelService {
  private proc: ChildProcess | null = null;
  private state: TunnelState = 'stopped';
  private url: string | null = null;
  private lastError: string | undefined;
  private stopping = false;

  info(): TunnelInfo {
    return {
      enabled: db.getSetting('tunnel_enabled') === 'true',
      state: this.state,
      url: this.url,
      error: this.lastError,
    };
  }

  private setState(state: TunnelState, url: string | null, error?: string): void {
    this.state = state;
    this.url = url;
    this.lastError = error;
    broadcast({ type: 'tunnel_status', tunnel: this.info() });
  }

  start(): void {
    if (this.proc) return;
    this.stopping = false;
    this.setState('starting', null);

    const proc = spawn(
      findCloudflared(),
      ['tunnel', '--url', `http://127.0.0.1:${config.port}`, '--no-autoupdate'],
      { windowsHide: true }
    );
    this.proc = proc;

    // cloudflared prints the assigned URL on stderr; watch both to be safe.
    const onData = (chunk: Buffer) => {
      if (this.state === 'running') return;
      const match = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        this.setState('running', match[0]);
        console.log(`[tunnel] Public URL: ${match[0]}`);
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('error', (err: NodeJS.ErrnoException) => {
      this.proc = null;
      if (err.code === 'ENOENT') {
        this.setState('not_installed', null, 'cloudflared is not installed');
        console.log('[tunnel] cloudflared not found — install it with: winget install --id Cloudflare.cloudflared');
      } else {
        this.setState('error', null, err.message);
        console.error('[tunnel] Failed to start cloudflared:', err.message);
      }
    });

    proc.on('exit', (code) => {
      this.proc = null;
      if (this.stopping) {
        this.setState('stopped', null);
      } else if (this.state !== 'not_installed') {
        this.setState('error', null, `cloudflared exited unexpectedly (code ${code})`);
        console.error(`[tunnel] cloudflared exited with code ${code}`);
      }
    });
  }

  stop(): void {
    if (!this.proc) {
      this.setState('stopped', null);
      return;
    }
    this.stopping = true;
    this.proc.kill();
  }
}

/**
 * Resolve the cloudflared binary. PATH is checked first (via spawn), but a
 * long-running server may have been started before cloudflared was installed
 * and hold a stale PATH — so fall back to the standard install locations.
 */
function findCloudflared(): string {
  const candidates = [
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
  ];
  for (const dir of (process.env.PATH ?? '').split(';')) {
    if (dir && fs.existsSync(`${dir}\\cloudflared.exe`)) return 'cloudflared';
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'cloudflared'; // let spawn produce ENOENT → reported as not_installed
}

export const tunnel = new TunnelService();
