<script lang="ts">
  import { fly } from 'svelte/transition';
  import { toasts, dismissToast } from '../lib/stores';
  import { fileUrl } from '../lib/api';
</script>

<div class="toasts" aria-live="polite">
  {#each $toasts as toast (toast.id)}
    <div class="toast card {toast.kind}" transition:fly={{ y: 20, duration: 200 }}>
      <div class="content">
        {#if toast.filename}
          <!-- Download toast: laid out like a row in the Files section. -->
          <div class="main">{toast.filename}</div>
          <div class="body">{toast.title}{toast.body ? ` · ${toast.body}` : ''}</div>
        {:else}
          <div class="main">{toast.title}</div>
          {#if toast.body}
            <div class="body">{toast.body}</div>
          {/if}
        {/if}
      </div>
      {#if toast.filename}
        <a class="open" href={fileUrl(toast.filename)} target="_blank" rel="noopener">Open</a>
      {/if}
      <button class="close" aria-label="Dismiss" on:click={() => dismissToast(toast.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 50;
    max-width: min(380px, calc(100vw - 32px));
  }

  @media (max-width: 640px) {
    .toasts {
      bottom: calc(var(--bottom-nav-height) + 12px);
      left: 16px;
      right: 16px;
    }
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border-left: 3px solid var(--accent);
  }

  .toast.success {
    border-left-color: var(--success);
  }

  .toast.error {
    border-left-color: var(--danger);
  }

  .content {
    flex: 1;
    min-width: 0;
  }

  /* Main line matches the file names in the Files section (weight 500). */
  .main {
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .body {
    color: var(--text-muted);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .open {
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
    align-self: center;
  }

  .close {
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 18px;
    line-height: 1;
    padding: 0 2px;
  }
</style>
