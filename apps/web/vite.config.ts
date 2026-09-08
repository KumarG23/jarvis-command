import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Only the explicitly requested synthetic HTTP preview needs UUID support.
    // This hook is absent from builds and ordinary development sessions.
    {
      name: 'synthetic-preview-compatibility',
      apply: 'serve',
      transformIndexHtml() {
        if (!process.argv.includes('--strictPort') || !process.argv.includes('4173')) return;
        return [{ tag: 'script', attrs: { src: '/preview-compat.js' }, injectTo: 'head-prepend' }];
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['jarvis-command.svg', 'pwa-192.png', 'pwa-512.png'],
      workbox: {
        navigateFallbackDenylist: [/^\/api(?:\/|\?|$)/, /^\/cdn-cgi(?:\/|\?|$)/],
      },
      manifest: {
        name: 'Jarvis Command',
        short_name: 'Command',
        description: 'Hermes-native operations and command environment',
        theme_color: '#090b10',
        background_color: '#090b10',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/jarvis-command.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    allowedHosts: ['terminal.local'],
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});

