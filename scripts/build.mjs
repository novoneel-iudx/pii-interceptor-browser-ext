import { build } from 'esbuild'
import fs from 'fs'
import path from 'path'

async function main() {

  // Clean dist
  if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true, force: true })
  }

  fs.mkdirSync('dist', { recursive: true })

  // Build TypeScript sources
  await build({
    entryPoints: [
      'src/content.ts',
      'src/background.ts',
      'src/options.ts'
    ],
    outdir: 'dist',
    bundle: true,
    format: 'iife',
    target: ['chrome120'],
    sourcemap: false,
    minify: false,
    legalComments: 'none'
  })

  // Copy manifest and html
  fs.copyFileSync('manifest.json', 'dist/manifest.json')
  fs.copyFileSync('options.html', 'dist/options.html')

  // Copy local NER models
  const modelSrc = 'src/models'
  const modelDest = 'dist/models'

  if (fs.existsSync(modelSrc)) {
    fs.cpSync(modelSrc, modelDest, { recursive: true })
  }

  console.log('Build complete')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})