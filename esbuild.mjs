import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isRelease = process.argv.includes('--release');

const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: !isRelease,
  minify: isRelease,
};

if (isWatch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log('Watching...');
} else {
  await esbuild.build(config);
  console.log('Build complete');
}
