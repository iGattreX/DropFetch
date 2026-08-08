<script lang="ts">
  import { notifications, unreadCount, markRead, markAllRead } from '../lib/stores';
  import { fileUrl, formatTime } from '../lib/api';
</script>

<div class="head">
  <span class="muted">
    {$unreadCount > 0 ? `${$unreadCount} unread` : 'All caught up'}
  </span>
  {#if $unreadCount > 0}
    <button on:click={markAllRead}>Mark all as read</button>
  {/if}
</div>

{#if $notifications.length === 0}
  <div class="empty">No downloads yet. Notifications appear here the moment a file is fetched.</div>
{:else}
  <ul>
    {#each $notifications as n (n.id)}
      <li class:unread={!n.read}>
        <span class="dot" aria-hidden="true"></span>
        <div class="info">
          <div class="filename">{n.filename}</div>
          <div class="meta muted">{n.channelTitle} · {formatTime(n.createdAt)}</div>
        </div>
        <div class="actions">
          <a
            href={fileUrl(n.filename)}
            target="_blank"
            rel="noopener"
            on:click={() => !n.read && markRead(n.id)}
          >
            View
          </a>
          {#if !n.read}
            <button class="link" on:click={() => markRead(n.id)}>Mark as read</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  li:last-child {
    border-bottom: none;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: transparent;
    flex-shrink: 0;
  }

  li.unread .dot {
    background: var(--accent);
  }

  li.unread .filename {
    font-weight: 600;
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .filename {
    overflow-wrap: anywhere;
  }

  .meta {
    font-size: 12px;
  }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
    font-size: 13px;
  }

  .actions a {
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
  }

  button.link {
    border: none;
    background: none;
    color: var(--text-muted);
    padding: 0;
    font-size: 12px;
  }

  button.link:hover {
    color: var(--text);
  }
</style>
