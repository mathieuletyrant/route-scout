import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve `@route-scout/core` to its source (not its built `dist`), so the tests
// run without a prior `pnpm build` — mirrors the tsconfig `paths` used for
// typecheck, and matters in CI where `test` runs before `build`.
const coreSrc = fileURLToPath(new URL('../core/src', import.meta.url));

export default defineConfig({
  plugins: [
    {
      // Core source uses NodeNext `.js` specifiers; map them back to the `.ts`.
      name: 'route-scout:resolve-ts-from-js',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
        const candidate = resolve(dirname(importer), source.replace(/\.js$/, '.ts'));
        return existsSync(candidate) ? candidate : null;
      },
    },
  ],
  resolve: {
    alias: { '@route-scout/core': resolve(coreSrc, 'index.ts') },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
