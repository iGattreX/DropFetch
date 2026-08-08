<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { api } from '../lib/api';
  import { showToast, tunnelInfo } from '../lib/stores';

  let token = '';
  let qrSvg = '';
  let toggling = false;

  onMount(async () => {
    try {
      const info = await api.tunnel();
      token = info.token;
      tunnelInfo.set(info);
    } catch {
      /* backend starting */
    }
  });

  // Points at /api/auth, not "/": the PWA's service worker caches "/" as the
  // app shell and would serve it straight from cache, never letting the
  // token reach the server. "/api/*" is excluded from that cache, so this
  // always round-trips to the server, which sets the cookie then redirects
  // to "/".
  $: shareUrl =
    $tunnelInfo?.state === 'running' && $tunnelInfo.url && token
      ? `${$tunnelInfo.url}/api/auth?token=${token}`
      : '';

  $: if (shareUrl) {
    QRCode.toString(shareUrl, { type: 'svg', margin: 1, width: 190 })
      .then((svg) => (qrSvg = svg))
      .catch(() => (qrSvg = ''));
  } else {
    qrSvg = '';
  }

  async function toggle() {
    if (!$tunnelInfo || toggling) return;
    toggling = true;
    try {
      await api.setTunnelEnabled(!$tunnelInfo.enabled);
      // State updates arrive over the WebSocket (tunnel_status events).
    } catch (err) {
      showToast({ kind: 'error', title: 'Could not update tunnel', body: String(err) });
    } finally {
      toggling = false;
    }
  }

  async function rotate() {
    try {
      const res = await api.rotateToken();
      token = res.token;
      showToast({
        kind: 'success',
        title: 'Access token rotated',
        body: 'Old links and devices are signed out. Re-scan the QR code on your phone.',
      });
    } catch (err) {
      showToast({ kind: 'error', title: 'Could not rotate token', body: String(err) });
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast({ kind: 'success', title: 'Link copied' });
    } catch {
      showToast({ kind: 'error', title: 'Could not copy — copy it manually' });
    }
  }

  const stateLabels: Record<string, string> = {
    stopped: 'Off',
    starting: 'Starting…',
    running: 'Running',
    error: 'Error',
    not_installed: 'cloudflared not installed',
  };
</script>

<section class="card">
  <h2>Remote access</h2>
  <label class="toggle-row">
    <div>
      <div>Cloudflare tunnel</div>
      <div class="muted small">
        Exposes DropFetch at a private, token-protected public URL so you can use it from your
        phone anywhere. Local access on this machine never needs the token.
      </div>
    </div>
    <span class="switch">
      <input
        type="checkbox"
        checked={$tunnelInfo?.enabled ?? false}
        disabled={toggling || !$tunnelInfo}
        on:change={toggle}
        aria-label="Enable Cloudflare tunnel"
      />
      <span class="slider"></span>
    </span>
  </label>

  {#if $tunnelInfo}
    <div class="status-row">
      <span
        class="status-dot"
        class:ok={$tunnelInfo.state === 'running'}
        class:warn={$tunnelInfo.state === 'starting'}
        class:off={$tunnelInfo.state === 'stopped'}
        aria-hidden="true"
      ></span>
      <span>{stateLabels[$tunnelInfo.state] ?? $tunnelInfo.state}</span>
      {#if $tunnelInfo.error && $tunnelInfo.state === 'error'}
        <span class="muted small">— {$tunnelInfo.error}</span>
      {/if}
    </div>

    {#if $tunnelInfo.state === 'not_installed'}
      <p class="muted small install-hint">
        Install the (free, no-account) Cloudflare tunnel client, then toggle again:
        <code>winget install --id Cloudflare.cloudflared</code>
      </p>
    {/if}

    {#if shareUrl}
      <div class="share">
        <div class="qr" aria-label="QR code for remote access link">
          {@html qrSvg}
        </div>
        <div class="share-info">
          <div class="muted small">
            Scan with your phone to open DropFetch with access included. The URL changes each
            time the tunnel restarts.
          </div>
          <div class="url">{$tunnelInfo.url}</div>
          <div class="share-actions">
            <button on:click={copyLink}>Copy link</button>
            <button on:click={rotate} title="Invalidate all existing links and devices">
              Rotate token
            </button>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  section {
    padding: 16px;
    margin-bottom: 16px;
  }

  h2 {
    font-size: 15px;
    margin: 0 0 4px;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
  }

  .small {
    font-size: 12px;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    font-size: 13px;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--danger);
    flex-shrink: 0;
  }

  .status-dot.ok {
    background: var(--success);
  }

  .status-dot.warn {
    background: orange;
  }

  .status-dot.off {
    background: var(--border);
  }

  .install-hint {
    margin: 8px 0 0;
  }

  code {
    background: var(--bg);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12px;
  }

  .share {
    display: flex;
    gap: 16px;
    margin-top: 14px;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  /* QR needs a light background to stay scannable in dark mode. */
  .qr {
    background: #fff;
    border-radius: 8px;
    padding: 8px;
    line-height: 0;
    flex-shrink: 0;
  }

  .qr :global(svg) {
    width: 190px;
    height: 190px;
    display: block;
  }

  .share-info {
    flex: 1;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .url {
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .share-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
