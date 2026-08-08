<script lang="ts">
  import { onMount } from 'svelte';
  import type { ChannelInfo } from '@shared/types';
  import { api } from '../lib/api';
  import { channelsVersion, scanProgress, showToast, tgStatus } from '../lib/stores';

  let channels: ChannelInfo[] = [];
  let loading = true;
  let error = '';
  /** Channels just toggled on — show the "scan existing messages?" prompt. */
  let scanPromptFor: Record<string, boolean> = {};

  async function load(initial = false) {
    if (initial) loading = true;
    try {
      channels = await api.channels();
      error = '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => load(true));

  // Reload once Telegram comes online.
  $: if ($tgStatus === 'connected' && error) load();

  // Re-sync (without a loading flicker) when another session toggles a channel.
  $: $channelsVersion, load();

  async function toggle(channel: ChannelInfo) {
    const next = !channel.monitored;
    channel.monitored = next;
    channels = channels;
    try {
      await api.setMonitored(channel.id, next);
      if (next) {
        scanPromptFor = { ...scanPromptFor, [channel.id]: true };
      } else {
        const { [channel.id]: _, ...rest } = scanPromptFor;
        scanPromptFor = rest;
      }
    } catch (err) {
      channel.monitored = !next;
      channels = channels;
      showToast({ kind: 'error', title: 'Could not update channel', body: String(err) });
    }
  }

  async function scan(channel: ChannelInfo) {
    dismissPrompt(channel.id);
    try {
      await api.scanChannel(channel.id);
      showToast({ kind: 'info', title: `Scanning ${channel.title}…` });
    } catch (err) {
      showToast({ kind: 'error', title: 'Scan failed to start', body: String(err) });
    }
  }

  function dismissPrompt(id: string) {
    const { [id]: _, ...rest } = scanPromptFor;
    scanPromptFor = rest;
  }

  async function scanAllMonitored() {
    try {
      const res = await api.scanAll();
      showToast({
        kind: 'info',
        title: res.channels > 0 ? `Scanning ${res.channels} channel(s)…` : 'No monitored channels to scan',
      });
    } catch (err) {
      showToast({ kind: 'error', title: 'Scan failed to start', body: String(err) });
    }
  }

  $: monitoredCount = channels.filter((c) => c.monitored).length;
</script>

<div class="head">
  <h1>Channels</h1>
  {#if monitoredCount > 0}
    <button on:click={scanAllMonitored}>Scan existing messages</button>
  {/if}
</div>

{#if loading}
  <div class="empty">Loading channels…</div>
{:else if error}
  <div class="empty card">
    Can't list channels: {error}
    <br />
    <span class="muted">
      {#if $tgStatus === 'not_logged_in'}
        Run <code>npm run login</code> in a terminal, then restart DropFetch.
      {:else if $tgStatus === 'no_credentials'}
        Set your Telegram API credentials in <code>.env</code> first — see Settings.
      {:else}
        Waiting for the Telegram connection…
      {/if}
    </span>
  </div>
{:else if channels.length === 0}
  <div class="empty card">No channels found on this Telegram account.</div>
{:else}
  <div class="card">
    <ul>
      {#each channels as channel (channel.id)}
        {@const progress = $scanProgress[channel.id]}
        <li>
          <div class="row">
            <div class="info">
              <div class="title">
                {channel.title}
                {#if channel.isMegagroup}<span class="tag">group</span>{/if}
              </div>
              <div class="meta muted">
                {#if channel.username}@{channel.username} · {/if}
                {#if channel.monitored}
                  <span class="monitoring">
                    <svg class="radar" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" opacity="0.35" />
                      <circle cx="12" cy="12" r="4.5" opacity="0.35" />
                      <path d="M12 12L18.4 5.6" />
                      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
                    </svg>
                    Monitoring
                  </span>
                {:else}
                  Not monitored
                {/if}
              </div>
            </div>
            {#if channel.monitored}
              <button
                class="scan-btn"
                title="Scan existing messages"
                on:click={() => scan(channel)}
                disabled={progress != null && !progress.done}
              >
                {progress && !progress.done ? 'Scanning…' : 'Scan'}
              </button>
            {/if}
            <label class="switch">
              <input
                type="checkbox"
                checked={channel.monitored}
                on:change={() => toggle(channel)}
                aria-label={`Monitor ${channel.title}`}
              />
              <span class="slider"></span>
            </label>
          </div>

          {#if scanPromptFor[channel.id]}
            <div class="prompt">
              <span>Scan this channel's existing messages for matching files?</span>
              <div class="prompt-actions">
                <button class="primary" on:click={() => scan(channel)}>Scan now</button>
                <button on:click={() => dismissPrompt(channel.id)}>Skip — only new messages</button>
              </div>
            </div>
          {/if}

          {#if progress}
            <div class="progress muted">
              {#if progress.error}
                Scan failed: {progress.error}
              {:else if progress.done}
                Scanned {progress.scanned} messages · {progress.matched} matched
              {:else}
                Scanning… {progress.scanned} messages · {progress.matched} matched
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 4px 0 16px;
  }

  h1 {
    font-size: 20px;
    margin: 0;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    border-bottom: 1px solid var(--border);
    padding: 12px 14px;
  }

  li:last-child {
    border-bottom: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .title {
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .tag {
    font-size: 11px;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1px 6px;
    margin-left: 6px;
    vertical-align: middle;
  }

  .meta {
    font-size: 12px;
  }

  .monitoring {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--accent);
    font-weight: 600;
    vertical-align: text-bottom;
  }

  /* Slow radar sweep — deliberately unlike a loading spinner. */
  .radar {
    animation: radar-sweep 3.5s linear infinite;
  }

  @keyframes radar-sweep {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .radar {
      animation: none;
    }
  }

  .scan-btn {
    font-size: 13px;
    flex-shrink: 0;
  }

  .prompt {
    margin-top: 10px;
    padding: 10px 12px;
    background: var(--accent-soft);
    border-radius: 8px;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .prompt-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .progress {
    margin-top: 6px;
    font-size: 12px;
  }

  code {
    background: var(--bg);
    padding: 1px 5px;
    border-radius: 4px;
  }
</style>
