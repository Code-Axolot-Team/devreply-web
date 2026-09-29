// The same language-matching cases as the iOS and Android SDKs: node --test tests/locale.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const out = await build({ entryPoints: ['src/i18n.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const { resolveLanguage, t, setLocaleOverride } = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text))
const vectors = JSON.parse(readFileSync(new URL('../../conformance/strings/locale-vectors.json', import.meta.url)))

for (const c of vectors.cases) {
  test(`${JSON.stringify(c.preferred)} → ${c.expect}`, () => assert.equal(resolveLanguage(c.preferred), c.expect))
}

test('texts fill their placeholders, in the chosen language', () => {
  setLocaleOverride('es-MX')
  assert.equal(t('launcher.many', { team: 'Fox', count: 3 }), 'Nuevas respuestas de Fox: 3')
  setLocaleOverride(null)
})
