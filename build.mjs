// One file for the page: dist/devreply.js (IIFE, Preact inside, nothing global but window.DevReply),
// plus the brand fonts next to it. Deployed to https://api.devreply.com/sdk/web/v0/ (deploy/deploy-web-sdk.sh).
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
mkdirSync('dist/fonts', { recursive: true })
await build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2019',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { __SDK_VERSION__: JSON.stringify(version) },
  legalComments: 'none',
  outfile: 'dist/devreply.js',
  banner: { js: `/* DevReply web SDK ${version} · https://devreply.com */` },
})
for (const f of ['archivo-black-latin.woff2', 'space-grotesk-latin.woff2']) {
  copyFileSync(`fonts/${f}`, `dist/fonts/${f}`)
}
const size = readFileSync('dist/devreply.js').length
console.log(`dist/devreply.js ${(size / 1024).toFixed(1)} KB`)
