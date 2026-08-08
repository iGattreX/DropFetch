<script lang="ts">
  import { onMount } from 'svelte';
  import TopNav from './components/TopNav.svelte';
  import BottomNav from './components/BottomNav.svelte';
  import Toasts from './components/Toasts.svelte';
  import FilesPage from './pages/FilesPage.svelte';
  import ChannelsPage from './pages/ChannelsPage.svelte';
  import KeywordsPage from './pages/KeywordsPage.svelte';
  import AlertsPage from './pages/AlertsPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import { activeTab, loadNotifications, tgStatus } from './lib/stores';
  import { notificationSound } from './lib/sound';
  import { themeMode, accentId } from './lib/theme';
  import { layoutMode, layoutColumns, SECTION_ORDER } from './lib/layout';
  import type { SectionId } from './lib/layout';
  import { api } from './lib/api';

  let isMobile = false;

  onMount(() => {
    const mq = matchMedia('(max-width: 640px)');
    isMobile = mq.matches;
    const onChange = (e: MediaQueryListEvent) => (isMobile = e.matches);
    mq.addEventListener('change', onChange);

    loadNotifications();
    api
      .status()
      .then((status) => {
        tgStatus.set(status.telegram);
        notificationSound.set(status.settings.notificationSound);
        // DB is the source of truth for appearance; localStorage is just the
        // pre-paint cache and gets refreshed by the store subscriptions.
        themeMode.set(status.settings.themeMode);
        accentId.set(status.settings.accentColor);
        layoutMode.set(status.settings.layoutMode);
        layoutColumns.set(status.settings.layoutColumns);
      })
      .catch(() => {
        /* backend starting up */
      });

    return () => mq.removeEventListener('change', onChange);
  });

  const isSection = (tab: string): tab is SectionId =>
    tab === 'files' || tab === 'channels' || tab === 'keywords';

  // Which sections render side-by-side for the current tab (desktop only).
  $: columns =
    !isMobile && isSection($activeTab)
      ? $layoutMode === 'three'
        ? SECTION_ORDER
        : $layoutMode === 'two' && $layoutColumns.includes($activeTab)
          ? SECTION_ORDER.filter((s) => $layoutColumns.includes(s))
          : [$activeTab]
      : isSection($activeTab)
        ? [$activeTab]
        : [];
</script>

<TopNav />

<main class:cols-2={columns.length === 2} class:cols-3={columns.length === 3}>
  {#if $activeTab === 'alerts'}
    <AlertsPage />
  {:else if $activeTab === 'settings'}
    <SettingsPage />
  {:else if columns.length > 1}
    <div class="columns" style="--cols: {columns.length}">
      {#each columns as section (section)}
        <section class="col">
          {#if section === 'files'}
            <FilesPage />
          {:else if section === 'channels'}
            <ChannelsPage />
          {:else}
            <KeywordsPage />
          {/if}
        </section>
      {/each}
    </div>
  {:else if $activeTab === 'files'}
    <FilesPage />
  {:else if $activeTab === 'channels'}
    <ChannelsPage />
  {:else if $activeTab === 'keywords'}
    <KeywordsPage />
  {/if}
</main>

<BottomNav />
<Toasts />

<style>
  main {
    max-width: 820px;
    margin: 0 auto;
    padding: 16px;
    padding-top: calc(var(--nav-height) + 16px);
    padding-bottom: 24px;
  }

  main.cols-2 {
    max-width: 1360px;
  }

  main.cols-3 {
    max-width: 1800px;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: 24px;
    align-items: start;
  }

  @media (max-width: 640px) {
    main {
      padding-bottom: calc(var(--bottom-nav-height) + 24px);
    }
  }
</style>
