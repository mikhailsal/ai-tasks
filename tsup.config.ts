import { defineConfig } from 'tsup';

// Every production entry is required; missing helpers must fail the build.
const entries = {
  cli: 'src/cli/main.ts',
  api: 'src/api/main.ts',
  'data-helper': 'src/api/data-helper-entry.ts',
  migrate: 'src/cli/migrate.ts',
  'locked-entry': 'src/runtime/locked-entry.ts',
  'database-lock': 'src/runtime/database-lock.ts',
  'restore-helper': 'src/runtime/restore-helper-entry.ts',
  'recovery-owner': 'src/runtime/recovery-owner-entry.ts',
};

export default defineConfig({
  entry: entries,
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  external: ['better-sqlite3'],
  // Bundle pure CLI dependencies to avoid repeated filesystem resolution in cold processes.
  // Keep native SQLite and the API's Fastify/Pino dependency graph external.
  noExternal: [
    /^drizzle-orm(?:\/|$)/u,
    /^zod(?:\/|$)/u,
    'commander',
    'marked',
    'sanitize-html',
    'emoji-regex',
    '@js-temporal/polyfill',
  ],
  // Bundled CommonJS sanitizer dependencies still require Node builtins such as path.
  banner: {
    js: "import { createRequire as __serverCreateRequire } from 'node:module'; const require = __serverCreateRequire(import.meta.url);",
  },
  splitting: true,
  sourcemap: true,
  clean: true,
  shims: true,
  dts: false,
  outExtension: () => ({ js: '.js' }),
});
