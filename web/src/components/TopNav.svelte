<script lang="ts">
  import { activeTab, unreadCount } from '../lib/stores';
  import type { Tab } from '../lib/stores';
  import { layoutMode, layoutColumns, SECTION_ORDER, SECTION_LABELS } from '../lib/layout';
  import type { LayoutMode, SectionId } from '../lib/layout';
  import NotificationsPanel from './NotificationsPanel.svelte';
  import LayoutPanel from './LayoutPanel.svelte';

  interface NavTab {
    id: Tab;
    label: string;
    /** All sections this tab represents (for combined-column tabs). */
    group: SectionId[];
  }

  function computeTabs(mode: LayoutMode, cols: SectionId[]): NavTab[] {
    if (mode === 'three') {
      return [{ id: 'files', label: 'Overview', group: [...SECTION_ORDER] }];
    }
    if (mode === 'two') {
      const grouped = SECTION_ORDER.filter((s) => cols.includes(s));
      const rest = SECTION_ORDER.filter((s) => !cols.includes(s));
      return [
        { id: grouped[0], label: grouped.map((s) => SECTION_LABELS[s]).join(' + '), group: grouped },
        ...rest.map((s) => ({ id: s, label: SECTION_LABELS[s], group: [s] as SectionId[] })),
      ];
    }
    return SECTION_ORDER.map((s) => ({ id: s, label: SECTION_LABELS[s], group: [s] as SectionId[] }));
  }

  $: tabs = computeTabs($layoutMode, $layoutColumns);

  const tabActive = (group: SectionId[], active: Tab) => group.includes(active as SectionId);

  let panelOpen = false;
  let layoutOpen = false;

  function togglePanel() {
    panelOpen = !panelOpen;
    layoutOpen = false;
  }

  function toggleLayout() {
    layoutOpen = !layoutOpen;
    panelOpen = false;
  }
</script>

<header class="nav">
  <button class="logo" on:click={() => activeTab.set('files')} aria-label="DropFetch home">
    <svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path
        d="M32 14v22m0 0l-8-8m8 8l8-8M18 42v4a4 4 0 004 4h20a4 4 0 004-4v-4"
        stroke="#fff"
        stroke-width="5"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
    </svg>
    <span>DropFetch</span>
  </button>

  <nav class="tabs" aria-label="Sections">
    {#each tabs as tab (tab.id)}
      <button
        class="tab"
        class:active={tabActive(tab.group, $activeTab)}
        on:click={() => activeTab.set(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </nav>

  <div class="actions">
    <button
      class="icon-btn desktop-only"
      class:active-icon={layoutOpen}
      aria-label="Layout"
      title="Layout"
      on:click={toggleLayout}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    </button>

    <button class="icon-btn" aria-label="Notifications" on:click={togglePanel}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 01-3.4 0" />
      </svg>
      {#if $unreadCount > 0}
        <span class="badge">{$unreadCount > 99 ? '99+' : $unreadCount}</span>
      {/if}
    </button>

    <button
      class="icon-btn"
      class:active-icon={$activeTab === 'settings'}
      aria-label="Settings"
      on:click={() => activeTab.set('settings')}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.09a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h.09a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.09a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    </button>
  </div>
</header>

{#if panelOpen}
  <NotificationsPanel on:close={() => (panelOpen = false)} />
{/if}

{#if layoutOpen}
  <LayoutPanel on:close={() => (layoutOpen = false)} />
{/if}

<style>
  .nav {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--nav-height);
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    z-index: 20;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 8px;
    border: none;
    background: none;
    padding: 4px;
    font-weight: 700;
    font-size: 16px;
  }

  .logo svg {
    border-radius: 6px;
  }

  .tabs {
    display: flex;
    gap: 4px;
    flex: 1;
  }

  .tab {
    border: none;
    background: none;
    color: var(--text-muted);
    padding: 8px 14px;
    border-radius: 8px;
    font-weight: 500;
  }

  .tab:hover {
    color: var(--text);
  }

  .tab.active {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .icon-btn {
    position: relative;
    border: none;
    background: none;
    color: var(--text-muted);
    padding: 8px;
    border-radius: 8px;
    display: flex;
  }

  .icon-btn:hover,
  .icon-btn.active-icon {
    color: var(--accent);
  }

  .badge {
    position: absolute;
    top: 2px;
    right: 0;
    background: var(--danger);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    padding: 3px 5px;
    border-radius: 9px;
    min-width: 16px;
    text-align: center;
  }

  /* Mobile: hide the inline tabs; the bottom bar takes over */
  @media (max-width: 640px) {
    .tabs {
      display: none;
    }

    .logo {
      flex: 1;
    }

    /* Layout switching is a desktop feature — mobile is always single column */
    .desktop-only {
      display: none;
    }
  }
</style>
