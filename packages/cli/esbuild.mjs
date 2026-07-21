import { rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

// Start clean: the published `dist/` must contain only the self-contained
// bundle, never stale files from a prior build.
rmSync('dist', { recursive: true, force: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  // Package is `type: module`; emit ESM so `import.meta.url` works natively and
  // no CJS shim is needed. `@route-scout/core` (+ its deps yaml/tinyglobby) are
  // bundled in, so the published package is self-contained with zero runtime deps.
  format: 'esm',
  target: 'node20',
  outfile: 'dist/cli.js',
  // esbuild preserves the entry file's `#!/usr/bin/env node` shebang.
  // Bundled CJS deps (yaml/tinyglobby) use `require()`. In ESM output esbuild's
  // interop shim throws "Dynamic require of X is not supported" unless a real
  // `require` exists — provide one via createRequire.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  sourcemap: watch,
  minify,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('esbuild: watching…');
} else {
  await esbuild.build(options);
}
