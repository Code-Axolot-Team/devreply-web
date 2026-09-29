// The script tag: dist/devreply.js (IIFE, Preact inside, nothing global but window.DevReply), plus the
// brand fonts next to it. Deployed to https://api.devreply.com/sdk/web/v0/ (deploy/deploy-web-sdk.sh).
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
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
  charset: 'utf8',
  legalComments: 'none',
  outfile: 'dist/devreply.js',
  banner: { js: `/* DevReply web SDK ${version} · https://devreply.com */` },
})
// The npm package: an ES module for bundlers (Preact bundled inside, so it never meets the app's
// React/Preact), and its types. Same code, no globals.
await build({
  entryPoints: ['src/module.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  target: 'es2019',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { __SDK_VERSION__: JSON.stringify(version) },
  charset: 'utf8',
  legalComments: 'none',
  outfile: 'dist/esm/devreply.mjs',
  banner: { js: `/* DevReply web SDK ${version} · https://devreply.com */` },
})
execSync('npx tsc -p tsconfig.types.json', { stdio: 'inherit' })

for (const f of ['archivo-black-latin.woff2', 'space-grotesk-latin.woff2', 'archivo-black-latin-ext.woff2', 'space-grotesk-latin-ext.woff2']) {
  copyFileSync(`fonts/${f}`, `dist/fonts/${f}`)
}
const size = readFileSync('dist/devreply.js').length
console.log(`dist/devreply.js ${(size / 1024).toFixed(1)} KB`)
