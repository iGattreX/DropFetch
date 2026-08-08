import './app.css';
import './lib/theme'; // applies saved theme + accent on import
import App from './App.svelte';
import { connectWs } from './lib/ws';

// The QR link carries ?token=…; the server has already exchanged it for a
// cookie by the time the page loads, so scrub it from the visible URL.
const url = new URL(location.href);
if (url.searchParams.has('token')) {
  url.searchParams.delete('token');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

connectWs();

const app = new App({
  target: document.getElementById('app')!,
});

export default app;
