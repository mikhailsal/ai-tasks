import { readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

async function javascriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return javascriptFiles(path);
      return /\.(?:js|mjs|cjs)$/u.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

// Read after all output hooks so later SW/public assets also enter the inventory.
export function browserAssets(): Plugin {
  let outputDirectory = '';
  let outputWritten = false;
  const emittedJavaScript = new Set<string>();
  return {
    name: 'browser-javascript-inventory',
    apply: 'build',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    buildStart() {
      emittedJavaScript.clear();
      outputWritten = false;
    },
    writeBundle() {
      outputWritten = true;
    },
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type === 'chunk') emittedJavaScript.add(asset.fileName);
      }
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        if (!outputWritten) return;
        for (const path of await javascriptFiles(outputDirectory)) {
          emittedJavaScript.add(relative(outputDirectory, path).replaceAll('\\', '/'));
        }
        await writeFile(
          join(outputDirectory, 'browser-assets.json'),
          `${JSON.stringify({ version: 1, javascript: [...emittedJavaScript].sort() }, null, 2)}\n`,
        );
      },
    },
  };
}
