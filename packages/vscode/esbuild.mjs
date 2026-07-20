import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: 'out/extension.js',
  sourcemap: watch,
  minify,
  logLevel: 'info',
  // Bundled ESM deps may use `import.meta.url` (e.g. `createRequire`). In a CJS
  // output that value is undefined, so shim it to the current file URL.
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: { js: "const importMetaUrl = require('url').pathToFileURL(__filename).href;" },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('esbuild: watching…');
} else {
  await esbuild.build(options);
}
