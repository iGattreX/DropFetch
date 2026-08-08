<script lang="ts">
  import { onMount } from 'svelte';
  import type { FileEntry } from '@shared/types';
  import { api, fileUrl, formatSize, formatTime } from '../lib/api';
  import { filesVersion, markAllRead, showToast } from '../lib/stores';

  let files: FileEntry[] = [];
  let loading = true;
  let error = '';

  async function load() {
    try {
      files = await api.files();
      error = '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // Refresh on downloads and read-state changes (bumped by the WS handler).
  $: $filesVersion, load();

  $: unreadCount = files.filter((f) => f.unread).length;

  async function markEverythingRead() {
    // Optimistic; the server broadcast re-syncs this and every other session.
    files = files.map((f) => (f.unread ? { ...f, unread: false } : f));
    try {
      await markAllRead();
    } catch (err) {
      showToast({ kind: 'error', title: 'Could not mark all as read', body: String(err) });
      load();
    }
  }
</script>

<div class="head">
  <h1>Files</h1>
  {#if unreadCount > 0}
    <button on:click={markEverythingRead}>Mark all as read ({unreadCount})</button>
  {/if}
</div>

{#if loading}
  <div class="empty">Loading…</div>
{:else if error}
  <div class="empty">Couldn't load files: {error}</div>
{:else if files.length === 0}
  <div class="empty card">
    The download folder is empty.<br />
    <span class="muted">Files matching your keywords will appear here automatically.</span>
  </div>
{:else}
  <div class="card">
    <ul>
      {#each files as f (f.name)}
        <li class:unread={f.unread}>
          <a class="file" href={fileUrl(f.name)} target="_blank" rel="noopener">
            <div class="icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                <path d="M13 2v7h7" />
              </svg>
            </div>
            <div class="info">
              <div class="name-row">
                <span class="name">{f.name}</span>
                {#if f.unread}<span class="badge">NEW</span>{/if}
                {#if f.sentAt}
                  <span class="sent-tag" title="When the message was posted in Telegram">
                    Sent {formatTime(f.sentAt)}
                  </span>
                {/if}
              </div>
              <div class="meta muted">
                {#if f.channelTitle}{f.channelTitle} · {/if}
                Downloaded {formatTime(f.downloadedAt ?? f.modifiedAt)} · {formatSize(f.size)}
              </div>
            </div>
            <svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M7 17L17 7M7 7h10v10" />
            </svg>
          </a>
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

  li.unread .name {
    font-weight: 650;
  }

  .badge {
    display: inline-block;
    background: var(--accent);
    color: var(--surface);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1;
    padding: 3px 6px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    border-bottom: 1px solid var(--border);
  }

  li:last-child {
    border-bottom: none;
  }

  .file {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    color: inherit;
    text-decoration: none;
  }

  .file:hover {
    background: var(--bg);
  }

  .icon {
    color: var(--accent);
    display: flex;
    flex-shrink: 0;
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .name-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    row-gap: 3px;
  }

  .name {
    overflow-wrap: anywhere;
    font-weight: 500;
  }

  .sent-tag {
    display: inline-block;
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: 6px;
    padding: 2px 7px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .meta {
    font-size: 12px;
    margin-top: 3px;
  }

  .chev {
    color: var(--text-muted);
    flex-shrink: 0;
  }
</style>
