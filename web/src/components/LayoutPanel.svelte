<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { layoutMode, layoutColumns } from '../lib/layout';
  import type { LayoutMode, SectionId } from '../lib/layout';
  import { api } from '../lib/api';
  import { showToast } from '../lib/stores';

  const dispatch = createEventDispatcher<{ close: void }>();

  const pairs: { id: string; label: string; cols: SectionId[] }[] = [
    { id: 'files,channels', label: 'Files + Channels', cols: ['files', 'channels'] },
    { id: 'files,keywords', label: 'Files + Keywords', cols: ['files', 'keywords'] },
    { id: 'channels,keywords', label: 'Channels + Keywords', cols: ['channels', 'keywords'] },
  ];

  async function save(mode: LayoutMode, cols: SectionId[]) {
    layoutMode.set(mode);
    layoutColumns.set(cols);
    try {
      await api.saveSettings({ layoutMode: mode, layoutColumns: cols });
    } catch (err) {
      showToast({ kind: 'error', title: 'Could not save layout', body: String(err) });
    }
  }

  function onPairChange(event: Event) {
    const id = (event.currentTarget as HTMLSelectElement).value;
    const pair = pairs.find((p) => p.id === id);
    if (pair) save('two', pair.cols);
  }
</script>

<button class="backdrop" aria-label="Close layout options" on:click={() => dispatch('close')}></button>

<div class="panel card" role="dialog" aria-label="Layout options">
  <h3>Layout</h3>

  <label class="option">
    <input
      type="radio"
      name="layout"
      checked={$layoutMode === 'single'}
      on:change={() => save('single', $layoutColumns)}
    />
    <div>
      <div>Single column</div>
      <div class="muted hint">Files, Channels and Keywords as separate tabs.</div>
    </div>
  </label>

  <label class="option">
    <input
      type="radio"
      name="layout"
      checked={$layoutMode === 'two'}
      on:change={() => save('two', $layoutColumns)}
    />
    <div>
      <div>Two columns</div>
      <div class="muted hint">Two sections side by side; the third stays a tab.</div>
    </div>
  </label>

  {#if $layoutMode === 'two'}
    <div class="pair-row">
      <select
        value={$layoutColumns.join(',')}
        on:change={onPairChange}
        aria-label="Sections shown side by side"
      >
        {#each pairs as pair (pair.id)}
          <option value={pair.id}>{pair.label}</option>
        {/each}
      </select>
    </div>
  {/if}

  <label class="option">
    <input
      type="radio"
      name="layout"
      checked={$layoutMode === 'three'}
      on:change={() => save('three', $layoutColumns)}
    />
    <div>
      <div>Three columns</div>
      <div class="muted hint">Files, Channels and Keywords all on one screen.</div>
    </div>
  </label>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    z-index: 29;
    cursor: default;
  }

  .panel {
    position: fixed;
    top: calc(var(--nav-height) + 8px);
    right: 12px;
    width: min(320px, calc(100vw - 24px));
    z-index: 30;
    padding: 14px;
  }

  h3 {
    font-size: 14px;
    margin: 0 0 10px;
  }

  .option {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 4px;
    cursor: pointer;
    border-radius: 8px;
  }

  .option:hover {
    background: var(--bg);
  }

  .option input {
    margin-top: 4px;
    accent-color: var(--accent);
  }

  .hint {
    font-size: 12px;
  }

  .pair-row {
    padding: 0 4px 8px 30px;
  }
</style>
