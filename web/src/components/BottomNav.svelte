<script lang="ts">
  import { activeTab, unreadCount } from '../lib/stores';
  import type { Tab } from '../lib/stores';

  const tabs: { id: Tab; label: string }[] = [
    { id: 'files', label: 'Files' },
    { id: 'channels', label: 'Channels' },
    { id: 'keywords', label: 'Keywords' },
    { id: 'alerts', label: 'Alerts' },
  ];
</script>

<nav class="bottom-nav" aria-label="Sections">
  {#each tabs as tab}
    <button class="item" class:active={$activeTab === tab.id} on:click={() => activeTab.set(tab.id)}>
      {#if tab.id === 'files'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
          <path d="M13 2v7h7" />
        </svg>
      {:else if tab.id === 'channels'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 2L11 13" />
          <path d="M22 2l-7 20-4-9-9-4z" />
        </svg>
      {:else if tab.id === 'keywords'}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
          <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      {:else}
        <span class="bell-wrap">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 01-3.4 0" />
          </svg>
          {#if $unreadCount > 0}
            <span class="badge">{$unreadCount > 99 ? '99+' : $unreadCount}</span>
          {/if}
        </span>
      {/if}
      <span class="label">{tab.label}</span>
    </button>
  {/each}
</nav>

<style>
  .bottom-nav {
    display: none;
  }

  @media (max-width: 640px) {
    .bottom-nav {
      display: flex;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: var(--bottom-nav-height);
      background: var(--surface);
      border-top: 1px solid var(--border);
      z-index: 20;
      padding-bottom: env(safe-area-inset-bottom);
    }

    .item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      border: none;
      background: none;
      color: var(--text-muted);
      border-radius: 0;
      padding: 4px 0;
    }

    .item.active {
      color: var(--accent);
    }

    .label {
      font-size: 11px;
      font-weight: 500;
    }

    .bell-wrap {
      position: relative;
      display: flex;
    }

    .badge {
      position: absolute;
      top: -4px;
      right: -8px;
      background: var(--danger);
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      line-height: 1;
      padding: 2px 4px;
      border-radius: 8px;
      min-width: 14px;
      text-align: center;
    }
  }
</style>
