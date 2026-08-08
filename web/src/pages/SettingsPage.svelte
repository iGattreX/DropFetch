<script lang="ts">
  import { onMount } from 'svelte';
  import type { StatusResponse } from '@shared/types';
  import { api } from '../lib/api';
  import { settingsVersion, showToast, tgStatus } from '../lib/stores';
  import { themeMode, accentId, accentOptions } from '../lib/theme';
  import type { ThemeMode } from '../lib/theme';
  import {
    soundEnabled,
    notificationSound,
    playNotificationSound,
    soundOptions,
  } from '../lib/sound';
  import RemoteAccessCard from '../components/RemoteAccessCard.svelte';

  let status: StatusResponse | null = null;
  let downloadDir = '';
  let saving = false;
  // Guards the folder field from rendering its unset default before the
  // real value arrives — otherwise it flashes empty/default for a moment on
  // every page load.
  let loaded = false;

  onMount(async () => {
    try {
      status = await api.status();
      downloadDir = status.settings.downloadDir;
      tgStatus.set(status.telegram);
      notificationSound.set(status.settings.notificationSound);
    } catch {
      /* backend starting */
    } finally {
      loaded = true;
    }
  });

  // Re-sync the folder field when another session saves settings
  // (theme/accent/sound stores are updated by the WS handler directly).
  async function syncFromServer() {
    try {
      const settings = await api.settings();
      downloadDir = settings.downloadDir;
    } catch {
      /* backend unreachable */
    }
  }

  $: if ($settingsVersion > 0) syncFromServer();

  async function changeTheme(mode: ThemeMode) {
    themeMode.set(mode);
    try {
      await api.saveSettings({ themeMode: mode });
    } catch (err) {
      showToast({ kind: 'error', title: 'Could not save theme', body: String(err) });
    }
  }

  async function changeAccent(id: string) {
    accentId.set(id);
    try {
      await api.saveSettings({ accentColor: id });
    } catch (err) {
      showToast({ kind: 'error', title: 'Could not save accent color', body: String(err) });
    }
  }

  function previewNotification() {
    // A real-looking test toast; showToast plays the tone if sound is enabled.
    showToast({
      kind: 'success',
      title: 'Test notification',
      body: 'A downloaded file will pop up like this.',
    });
  }

  async function changeSound(event: Event) {
    const id = (event.currentTarget as HTMLSelectElement).value;
    notificationSound.set(id);
    playNotificationSound(id, true); // instant preview of the new choice
    try {
      await api.saveSettings({ notificationSound: id });
    } catch (err) {
      showToast({ kind: 'error', title: 'Could not save sound', body: String(err) });
    }
  }

  async function saveFolder() {
    saving = true;
    try {
      const settings = await api.saveSettings({ downloadDir });
      downloadDir = settings.downloadDir;
      showToast({ kind: 'success', title: 'Download folder saved' });
    } catch (err) {
      showToast({ kind: 'error', title: 'Could not save folder', body: String(err) });
    } finally {
      saving = false;
    }
  }

  const themeModes: { id: ThemeMode; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];

  const statusLabels: Record<string, string> = {
    connected: 'Connected',
    connecting: 'Connecting…',
    not_logged_in: 'Not logged in',
    no_credentials: 'API credentials missing',
    error: 'Connection error',
  };
</script>

<h1>Settings</h1>

{#if loaded}
  <section class="card">
    <h2>Download folder</h2>
    <p class="muted">Matched files are saved here. The folder is created if it doesn't exist.</p>
    <div class="folder-row">
      <input type="text" bind:value={downloadDir} aria-label="Download folder path" />
      <button class="primary" on:click={saveFolder} disabled={saving || !downloadDir.trim()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </section>
{:else}
  <section class="card loading-placeholder">
    <div class="muted">Loading settings…</div>
  </section>
{/if}

<section class="card">
  <h2>Notifications</h2>
  <label class="toggle-row">
    <div>
      <div>Notification sound</div>
      <div class="muted small">
        Plays a sound on this device when a matching file has been downloaded.
      </div>
    </div>
    <span class="switch">
      <input
        type="checkbox"
        checked={$soundEnabled}
        on:change={() => soundEnabled.update((v) => !v)}
        aria-label="Notification sound"
      />
      <span class="slider"></span>
    </span>
  </label>
  <div class="sound-row" class:disabled={!$soundEnabled}>
    <span>Sound</span>
    <div class="sound-controls">
      <select
        value={$notificationSound}
        on:change={changeSound}
        disabled={!$soundEnabled}
        aria-label="Notification sound choice"
      >
        {#each soundOptions as option (option.id)}
          <option value={option.id}>{option.label}</option>
        {/each}
      </select>
      <button class="test-btn" on:click={previewNotification}>Preview</button>
    </div>
  </div>
</section>

<section class="card">
  <h2>Appearance</h2>
  <div class="appearance-row">
    <span>Theme</span>
    <div class="segmented" role="radiogroup" aria-label="Theme">
      {#each themeModes as mode}
        <button
          role="radio"
          aria-checked={$themeMode === mode.id}
          class:selected={$themeMode === mode.id}
          on:click={() => changeTheme(mode.id)}
        >
          {mode.label}
        </button>
      {/each}
    </div>
  </div>
  <div class="appearance-row">
    <span>Accent color</span>
    <div class="swatches" role="radiogroup" aria-label="Accent color">
      {#each accentOptions as accent (accent.id)}
        <button
          class="swatch"
          role="radio"
          aria-checked={$accentId === accent.id}
          class:selected={$accentId === accent.id}
          style="--swatch-light: {accent.light}; --swatch-dark: {accent.dark}"
          title={accent.label}
          aria-label={accent.label}
          on:click={() => changeAccent(accent.id)}
        ></button>
      {/each}
    </div>
  </div>
</section>

<RemoteAccessCard />

<section class="card">
  <h2>Telegram</h2>
  <div class="tg-row">
    <span
      class="status-dot"
      class:ok={$tgStatus === 'connected'}
      class:warn={$tgStatus === 'connecting'}
      aria-hidden="true"
    ></span>
    <div>
      <div>
        {statusLabels[$tgStatus] ?? $tgStatus}
        {#if status?.telegramUser && $tgStatus === 'connected'}
          <span class="muted">as {status.telegramUser}</span>
        {/if}
      </div>
      <div class="muted small">
        {#if $tgStatus === 'no_credentials'}
          Add <code>TELEGRAM_API_ID</code> and <code>TELEGRAM_API_HASH</code> to the
          <code>.env</code> file (get them at my.telegram.org), then restart DropFetch.
        {:else if $tgStatus === 'not_logged_in'}
          Credentials found, but no session. Run <code>npm run login</code> in a terminal in the
          DropFetch folder, then restart the app.
        {:else if $tgStatus === 'connected'}
          Live monitoring is active. API credentials are read from <code>.env</code> and never
          shown here.
        {:else}
          Trying to reach Telegram…
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  h1 {
    font-size: 20px;
    margin: 4px 0 16px;
  }

  section {
    padding: 16px;
    margin-bottom: 16px;
  }

  .loading-placeholder {
    /* Matches the download-folder card's height, so the page below doesn't
       jump once the real content swaps in. */
    min-height: 92px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  h2 {
    font-size: 15px;
    margin: 0 0 4px;
  }

  p {
    margin: 0 0 12px;
    font-size: 13px;
  }

  .folder-row {
    display: flex;
    gap: 8px;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
  }

  .small {
    font-size: 12px;
  }

  .test-btn {
    font-size: 13px;
    padding: 6px 12px;
    flex-shrink: 0;
  }

  .sound-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .sound-row.disabled > span {
    color: var(--text-muted);
  }

  .sound-controls {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .appearance-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: 6px 0;
  }

  .segmented {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .segmented button {
    border: none;
    border-radius: 0;
    background: none;
    color: var(--text-muted);
    padding: 6px 14px;
    font-size: 13px;
  }

  .segmented button + button {
    border-left: 1px solid var(--border);
  }

  .segmented button.selected {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .swatches {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .swatch {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    padding: 0;
    border: 2px solid transparent;
    background: var(--swatch-light);
  }

  :global(:root[data-theme='dark']) .swatch {
    background: var(--swatch-dark);
  }

  .swatch.selected {
    border-color: var(--text);
    box-shadow: 0 0 0 2px var(--surface) inset;
  }

  .tg-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--danger);
    margin-top: 6px;
    flex-shrink: 0;
  }

  .status-dot.ok {
    background: var(--success);
  }

  .status-dot.warn {
    background: orange;
  }

  code {
    background: var(--bg);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12px;
  }
</style>
