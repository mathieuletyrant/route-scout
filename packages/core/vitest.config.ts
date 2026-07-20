import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Source uses NodeNext `.js` specifiers; map them back to the `.ts` on disk for tests.
export default defineConfig({
  plugins: [
    {
      name: 'route-scout:resolve-ts-from-js',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
        const candidate = resolve(dirname(importer), source.replace(/\.js$/, '.ts'));
        return existsSync(candidate) ? candidate : null;
      },
    },
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
