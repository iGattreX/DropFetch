# DropFetch

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A lightweight personal app that watches your Telegram channels and auto-downloads
files **before the channels' auto-delete policy removes them**.

Built with Node.js/TypeScript (Fastify + GramJS + SQLite) and a Svelte PWA
frontend. Commands below use PowerShell and assume Windows (the pm2-as-a-
Windows-service section in particular is Windows-specific); the Node/Fastify
backend itself is not Windows-only, but only the Windows setup path has been
tested end to end. Requires Node.js 18+.

- Monitors channels you select, in real time, using **your own Telegram account**
  (a user session via [GramJS](https://gram.js.org/) — not a bot, so it can read
  any channel you're subscribed to).
- Downloads any document whose **filename matches your keywords**
  (case-insensitive, multiple keywords supported; a multi-word keyword matches
  when all of its words appear in the filename, in any order).
- Crash-safe dedup ledger in SQLite: the same file is never downloaded twice,
  even if the app dies mid-download and restarts.
- Responsive web UI (installable PWA): Files / Channels / Keywords / Alerts /
  Settings, with live toasts and a notification bell.
- One Node.js process. Fastify serves the API, the WebSocket, the built UI, and
  the downloaded files themselves.

## Acceptable use & disclaimer

DropFetch is a personal automation tool for archiving files from Telegram
channels **you are already a legitimate member of** — its purpose is to
preserve your own access to content before a channel's auto-delete policy
removes it, not to bypass any access control. It only ever sees messages and
files your own Telegram account can already see.

If you run this tool, you're responsible for:
- Only monitoring channels you're legitimately subscribed to, and only
  downloading files you have the right to access and keep.
- Complying with applicable copyright law and Telegram's Terms of Service.
- Whatever you do with the files it downloads — DropFetch has no way to know,
  and takes no position on, the legitimacy of any specific file.

This project is provided **"as is"** under the [MIT License](#license): the
author assumes no responsibility or liability for how this software is used,
including any misuse to download, retain, or redistribute content you don't
have the rights to. It's a personal tool shared in good faith for individuals
managing their own Telegram content — not a hosted service, and nothing here
is legal advice.

---

## 1. Get a Telegram API ID and hash

1. Go to <https://my.telegram.org> and log in with your phone number.
2. Open **API development tools**.
3. Create an app (any name/short name; platform "Desktop" is fine).
4. Copy the **App api_id** and **App api_hash**.

These identify *your client app*; your account login happens separately in step 3.

## 2. Install & configure

```powershell
git clone https://github.com/iGattreX/DropFetch.git
cd DropFetch
npm install
npm --prefix web install

copy .env.example .env
# then edit .env and fill in:
#   TELEGRAM_API_ID=1234567
#   TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
```

Secrets stay out of git: `.env`, the `data/` folder (SQLite DB + Telegram
session), and `downloads/` are all in `.gitignore`.

## 3. First-run Telegram login (interactive, once)

```powershell
npm run login
```

You'll be asked for your phone number (international format), the login code
Telegram sends you, and your 2FA password if you have one. The session is saved
in the SQLite database (`data/dropfetch.db`), so it survives restarts — you
won't be asked again unless you revoke the session from Telegram's settings.

> If DropFetch is already running (dev server or pm2), restart it after logging
> in so it picks up the new session.

## 4. Run in development

Two terminals:

```powershell
npm run dev          # backend on http://localhost:8090 (restarts on changes)
npm run dev:web      # Vite dev server on http://localhost:5173 (proxies to 8090)
```

Open <http://localhost:5173>. In dev, the Vite server proxies `/api`, `/files`,
and `/ws` to the backend.

## 5. Build for production

```powershell
npm run build        # compiles the backend to dist/ and the UI to web/dist/
npm start            # single process on http://localhost:8090
```

In production the backend serves the built PWA itself — open
<http://localhost:8090> (or `http://<laptop-ip>:8090` from your phone on the
same network; you can "install" it from the browser menu since it's a PWA).

## 6. Run in the background with pm2 (start on boot)

```powershell
npm install -g pm2
npm run build
pm2 start ecosystem.config.js
pm2 save
```

To start pm2 itself when Windows boots, the simplest reliable option on Windows
is [pm2-installer](https://github.com/jessety/pm2-installer), which sets pm2 up
as a Windows service:

```powershell
# in a separate folder, as Administrator:
git clone https://github.com/jessety/pm2-installer
cd pm2-installer
npm run configure
npm run setup
# then, back in the DropFetch folder:
pm2 start ecosystem.config.js
pm2 save
```

(Alternative: create a Task Scheduler task that runs `pm2 resurrect` at logon.)

Useful commands: `pm2 status`, `pm2 logs dropfetch`, `pm2 restart dropfetch`.

## Using the app

1. **Settings** — check that Telegram shows *Connected* and set your download
   folder. DropFetch always sweeps monitored channels for anything missed
   while offline — at startup, the moment the connection recovers from a
   drop, and every 5 minutes as a backstop — so there's nothing to configure
   for that. The **Appearance** section lets you pick light/dark/system theme
   and an accent color; both are stored in the DB (defaults: system theme,
   teal accent) and shared across devices. On desktop, the **layout icon** in the
   top bar switches between single-column tabs, two columns (pick which pair
   sits side by side; the third section stays a tab), or all three sections
   as columns on one screen. Mobile always uses the single-column tab layout.
2. **Keywords** — add filename keywords (e.g. `report`, `invoice`, `.pdf`).
   A file is downloaded when its filename contains any keyword
   (case-insensitive). A keyword with spaces matches when **all** of its words
   appear in the filename, in any order — e.g. `daily report` matches
   `Report-Daily-June.pdf`.
3. **Channels** — toggle the channels you want to monitor. When you enable one,
   you're offered a one-time **"Scan existing messages"** for files already in
   the channel — or skip it to only capture new messages from that point on.
   You can also scan any monitored channel (or all of them) at any time.
   Besides live updates, DropFetch also reconciles monitored channels in the
   background — immediately when the Telegram connection recovers from a
   drop, and every 5 minutes regardless as a backstop — so a file posted
   during a brief connection blip (network hiccup, sleep/wake) still gets
   picked up automatically, without needing a manual scan.
4. **Files** — everything in your download folder, with source channel and
   size; click a file to open it in a new tab. Each file shows a **Sent**
   tag with when the message was originally posted in Telegram, alongside
   when DropFetch actually downloaded it — useful since those can differ if
   a file was caught by a catch-up sweep rather than live. Files you haven't looked at yet
   carry a **NEW** badge that stays in sync with the notification bell: opening
   a file (from anywhere), marking its notification read, or the **Mark all as
   read** button clears both at once — across every open session. All state
   changes (read markers, keywords, channels, settings, theme) push live over
   the WebSocket to every open tab and device.
5. **Alerts / bell icon** — a toast pops up (with a notification sound —
   pick from knock, ding, chime, and more in Settings, with preview) the
   moment a file is downloaded; the bell keeps the history with unread
   markers, per-item **View** / **Mark as read**, and **Mark all as read**.
   The sound choice is stored in the DB; the on/off switch is per device.
   Browsers only allow sound after you've interacted with the page at least
   once per session.

## Remote access from your phone (Cloudflare tunnel)

DropFetch can expose itself at a token-protected public URL so the PWA works
from anywhere, not just your home network:

1. Install the free tunnel client (no Cloudflare account needed):
   `winget install --id Cloudflare.cloudflared`
2. In **Settings → Remote access**, enable the tunnel. After a few seconds a
   `https://….trycloudflare.com` URL and a **QR code** appear.
3. Scan the QR with your phone — the link carries a one-time `?token=…` that
   the server exchanges for a long-lived cookie, then disappears from the URL.
   Install the PWA from the browser menu if you like.

Security model: requests arriving through the tunnel must present the access
token (QR link, its cookie, or an `Authorization: Bearer` header); requests on
localhost/LAN are trusted without it. **Rotate token** in Settings invalidates
every previously shared link/device. Note that quick tunnels get a *new URL on
every restart* — re-scan the QR when that happens. If you want a stable URL,
set up a named Cloudflare tunnel with your own domain and point it at
`http://localhost:8090` (the token protection applies the same way).

## Staying connected across sleep/wake and network blips

A laptop that sleeps and wakes can leave the Telegram connection in a "zombie"
state — neither cleanly closed nor actually able to send or receive, which
network libraries don't always detect promptly on their own. DropFetch guards
against this at two levels:

- **Process-level safety net** — an unhandled internal error deep in the
  Telegram library would otherwise crash the whole Node process by default
  (taking down the web UI and API too, not just Telegram), with nothing to
  restart it outside of pm2. `src/index.ts` installs a top-level handler so
  this gets logged instead of killing the app.
- **Connection health check** — every 2 minutes, a cheap round-trip call
  confirms the connection can actually respond, separately from the file-sweep
  reconcile loop (so a legitimately slow large-file download is never mistaken
  for a dead connection). If it doesn't respond within 10 seconds, DropFetch
  tears the connection down and reconnects from scratch, rather than waiting
  on the Telegram library's own recovery.

Combined with the reconnect-triggered and periodic reconcile sweeps described
above, a dropped connection — whatever the cause — should recover on its own
within a couple of minutes at worst, without needing a manual restart.

## How the dedup ledger works

Every candidate file is keyed by `(channel id, message id, document id)` in the
`downloads` table. A row is inserted as `pending` *before* the download starts;
the file is written to a `.part` temp file, renamed into place only when fully
written, and only then is the row marked `complete`. On startup, DropFetch
retries any `pending`/`failed` rows whose messages still exist. A row marked
`complete` is never downloaded again.

## Project layout

```
src/            backend (Fastify + GramJS + better-sqlite3)
  index.ts      entry point
  telegram.ts   monitoring, scanning, crash-safe downloads
  server.ts     HTTP API, WebSocket, static files
  db.ts         SQLite schema + queries
  login.ts      interactive first-run login
shared/types.ts API + WebSocket payload types shared with the UI
web/            Svelte + Vite PWA frontend
data/           SQLite DB + Telegram session (gitignored)
downloads/      default download folder (gitignored, configurable in Settings)
```

## License

[MIT](LICENSE) © 2026 [iGattreX](https://github.com/iGattreX)
