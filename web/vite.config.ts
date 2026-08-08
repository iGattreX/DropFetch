import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'DropFetch',
        short_name: 'DropFetch',
        description: 'Auto-download Telegram channel files before they are deleted',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Never cache API/file responses — this app is about fresh data.
        navigateFallbackDenylist: [/^\/api/, /^\/files/, /^\/ws/]
      }
    })
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared')
    }
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:8090',
      '/files': 'http://localhost:8090',
      '/ws': { target: 'ws://localhost:8090', ws: true }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
