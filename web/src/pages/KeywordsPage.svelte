<script lang="ts">
  import { onMount } from 'svelte';
  import type { KeywordRule } from '@shared/types';
  import { api } from '../lib/api';
  import { keywordsVersion, showToast } from '../lib/stores';

  let keywords: KeywordRule[] = [];
  let input = '';
  let loading = true;

  async function load() {
    try {
      keywords = await api.keywords();
    } catch {
      /* backend starting */
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // Re-sync when another session adds/removes keywords.
  $: $keywordsVersion, load();

  async function add() {
    const value = input.trim();
    if (!value) return;
    try {
      const rule = await api.addKeyword(value);
      keywords = [rule, ...keywords];
      input = '';
    } catch (err) {
      showToast({ kind: 'error', title: 'Could not add keyword', body: String(err) });
    }
  }

  async function remove(rule: KeywordRule) {
    keywords = keywords.filter((k) => k.id !== rule.id);
    try {
      await api.removeKeyword(rule.id);
    } catch (err) {
      keywords = [rule, ...keywords];
      showToast({ kind: 'error', title: 'Could not remove keyword', body: String(err) });
    }
  }
</script>

<h1>Keywords</h1>
<p class="muted intro">
  A file is downloaded when its <strong>filename</strong> contains any of these keywords
  (case-insensitive). A keyword with spaces matches when <strong>all</strong> of its words
  appear in the filename, in any order — e.g. <code>daily report</code> matches
  "Report-Daily-June.pdf".
</p>

<form class="add" on:submit|preventDefault={add}>
  <input
    type="text"
    placeholder="e.g. report, invoice, .pdf"
    bind:value={input}
    aria-label="New keyword"
  />
  <button class="primary" type="submit" disabled={!input.trim()}>Add</button>
</form>

{#if loading}
  <div class="empty">Loading…</div>
{:else if keywords.length === 0}
  <div class="empty card">
    No keywords yet — nothing will be downloaded until you add at least one.
  </div>
{:else}
  <div class="card">
    <ul>
      {#each keywords as rule (rule.id)}
        <li>
          <span class="kw">{rule.keyword}</span>
          <button class="remove" aria-label={`Remove ${rule.keyword}`} on:click={() => remove(rule)}>
            Remove
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  h1 {
    font-size: 20px;
    margin: 4px 0 8px;
  }

  .intro {
    margin: 0 0 16px;
    font-size: 13px;
  }

  .intro code {
    background: var(--bg);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12px;
  }

  .add {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  li:last-child {
    border-bottom: none;
  }

  .kw {
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    font-size: 14px;
    overflow-wrap: anywhere;
  }

  .remove {
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 13px;
    flex-shrink: 0;
  }

  .remove:hover {
    color: var(--danger);
  }
</style>
