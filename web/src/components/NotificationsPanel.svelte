<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import NotificationList from './NotificationList.svelte';

  const dispatch = createEventDispatcher<{ close: void }>();
</script>

<button class="backdrop" aria-label="Close notifications" on:click={() => dispatch('close')}></button>

<div class="panel card" role="dialog" aria-label="Notifications">
  <NotificationList />
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
    width: min(400px, calc(100vw - 24px));
    max-height: 70vh;
    overflow-y: auto;
    z-index: 30;
  }
</style>
