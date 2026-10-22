import { defineConfig } from 'tsup';
import { readFile } from 'node:fs/promises';

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
  // Bundle JavaScript wrappers too; SQLite's dynamically required native addon
  // and the API's Fastify/Pino dependency graph stay external.
  noExternal: [
    /^better-sqlite3(?:\/|$)/u,
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
    js: "import { createRequire as __serverCreateRequire } from 'node:module'; const require = __serverCreateRequire(import.meta.url); const __serverRequire = require;",
  },
  esbuildPlugins: [
    {
      name: 'sqlite-native-location',
      setup(build) {
        build.onLoad(
          { filter: /[/\\]better-sqlite3[/\\]lib[/\\]binding\.js$/ },
          async ({ path }) => {
            const source = await readFile(path, 'utf8');
            if (source.match(/\b__dirname\b/gu)?.length !== 3)
              throw new Error('Review the pinned SQLite native binding layout before bundling');
            // Preserve upstream prebuild, libc and source-build selection relative
            // to the installed package, rather than the generated chunk directory.
            return {
              contents: source.replaceAll(
                '__dirname',
                'path.dirname(__serverRequire.resolve("better-sqlite3"))',
              ),
              loader: 'js',
            };
          },
        );
      },
    },
  ],
  splitting: true,
  minify: true,
  sourcemap: true,
  clean: true,
  shims: true,
  dts: false,
  outExtension: () => ({ js: '.js' }),
});
