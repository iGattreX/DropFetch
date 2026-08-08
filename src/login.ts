/**
 * Interactive first-run Telegram login (phone + code, optional 2FA password).
 * Persists the session string in the SQLite DB so the main app can reuse it.
 *
 * Usage: npm run login
 */
import readline from 'node:readline';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { config, hasCredentials } from './config';
import { getSetting, setSetting } from './db';

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

async function main() {
  if (!hasCredentials()) {
    console.error(
      'Missing TELEGRAM_API_ID / TELEGRAM_API_HASH.\n' +
        'Get them at https://my.telegram.org (API development tools), put them in .env, then re-run.'
    );
    process.exit(1);
  }

  const existing = getSetting('tg_session') ?? '';
  const client = new TelegramClient(new StringSession(existing), config.apiId, config.apiHash, {
    connectionRetries: 5,
    useWSS: true, // same TLS transport as the main app (survives MTProto filtering)
  });

  await client.start({
    phoneNumber: () => ask('Phone number (international format, e.g. +15551234567): '),
    phoneCode: () => ask('Login code you received in Telegram: '),
    password: () => ask('Two-factor password (leave empty if none): '),
    onError: async (err) => {
      console.error('Login error:', err.message);
      return true; // abort on error
    },
  });

  const session = client.session.save() as unknown as string;
  setSetting('tg_session', session);
  const me = await client.getMe();
  console.log(`\nLogged in as ${me.username ? '@' + me.username : me.firstName}. Session saved.`);
  console.log('You can now start DropFetch (npm run dev / pm2). If it is already running, restart it.');
  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Login failed:', err);
  process.exit(1);
});
