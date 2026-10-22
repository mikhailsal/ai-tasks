import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { browserAssets } from '../scripts/browser-assets.js';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const serverRoot = resolve(webRoot, '../src');
const serverPackages = [
  'better-sqlite3',
  'drizzle-orm',
  'fastify',
  '@fastify/static',
  'commander',
  '@js-temporal/polyfill',
  'marked',
  'sanitize-html',
  'emoji-regex',
];
const browserSchemaFiles = new Set([
  'audit.ts',
  'values.ts',
  'envelopes.ts',
  'errors.ts',
  'configuration.ts',
  'configuration-migration.ts',
  'meta.ts',
  'scopes.ts',
  'projects.ts',
  'recurrence-input.ts',
  'recurrence-query.ts',
  'settings.ts',
  'tasks.ts',
  'task-query.ts',
  'read-views.ts',
  'recovery.ts',
]);

function browserBoundary(): Plugin {
  return {
    name: 'browser-server-boundary',
    enforce: 'pre',
    resolveId(source) {
      const nodeModule = source.replace(/^node:/u, '');
      const forbidden =
        source.startsWith('node:') ||
        builtinModules.includes(nodeModule) ||
        serverPackages.some((name) => source === name || source.startsWith(`${name}/`));
      if (forbidden) {
        this.error(`Server-only module cannot enter the browser build: ${source}`);
      }
      return null;
    },
    load(id) {
      const path = id.split('?')[0] ?? id;
      if (serverPackages.some((name) => path.includes(`/node_modules/${name}/`))) {
        this.error(`Server-only package cannot enter the browser build: ${path}`);
      }
      if (!path.startsWith(`${serverRoot}/`)) return null;
      const schemaFile = path.slice(`${serverRoot}/schema/`.length);
      if (!path.startsWith(`${serverRoot}/schema/`) || !browserSchemaFiles.has(schemaFile)) {
        this.error(`Only browser-safe schema modules may enter the UI: ${path}`);
      }
      return null;
    },
  };
}

export default defineConfig({
  root: webRoot,
  plugins: [
    browserBoundary(),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{html,js,css,svg,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 2_000_000,
        rollupFormat: 'es',
      },
    }),
    browserAssets(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    manifest: true,
    sourcemap: false,
  },
});
