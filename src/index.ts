import { config } from './config';
import { getSetting } from './db';
import { buildServer } from './server';
import { telegram } from './telegram';
import { tunnel } from './tunnel';

/**
 * Safety net for a long-running background process: GramJS runs its own
 * internal update/reconnect loop as a fire-and-forget async call with no
 * .catch() at the call site. If anything inside it ever rejects in a way
 * its own try/catch doesn't cover — plausible around a laptop sleep/wake
 * cycle, where a reconnect attempt can hit unusual internal state — Node
 * treats that as an unhandled rejection and terminates the whole process by
 * default (since Node 15). That would take down the entire app (web UI and
 * API included, not just Telegram), with nothing to restart it outside of
 * pm2. Logging and surviving is strictly better than dying silently here.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[dropfetch] Unhandled rejection (process kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[dropfetch] Uncaught exception (process kept alive):', err);
});

async function main() {
  const app = await buildServer();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[dropfetch] Web UI on http://localhost:${config.port}`);

  // Telegram connects in the background; the UI works (with limited features)
  // even before login.
  void telegram.start();

  if (getSetting('tunnel_enabled') === 'true') {
    tunnel.start();
  }
}

main().catch((err) => {
  console.error('[dropfetch] Fatal:', err);
  process.exit(1);
});
