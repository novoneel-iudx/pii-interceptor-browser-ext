import { build } from 'esbuild';
import fs from 'fs';

async function main() {
  if (fs.existsSync('dist')) {
    fs.rmdirSync('dist', { recursive: true });
  }
  fs.mkdirSync('dist', { recursive: true });

  await build({
    entryPoints: ['src/content.ts', 'src/background.ts', 'src/options.ts'],
    outdir: 'dist',
    bundle: true,
    format: 'iife',
    target: ['chrome120'],
    sourcemap: false,
    minify: false,
    legalComments: 'none'
  });

  fs.copyFileSync('manifest.json', 'dist/manifest.json');
  fs.copyFileSync('options.html', 'dist/options.html');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
