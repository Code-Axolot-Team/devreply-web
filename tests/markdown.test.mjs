// DevReply Markdown: the same cases as the server, iOS, Android and the dashboard (spec 05).
// node --test tests/markdown.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const out = await build({
  stdin: { contents: "export * from './src/markdown.ts'; export { parseBlock, plainText } from './src/api.ts'", resolveDir: '.', loader: 'ts' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  define: { __SDK_VERSION__: '"0.4.4"' },
})
const { parseMarkdown, plainMarkdown, parseBlock, plainText } = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text))
const { cases } = JSON.parse(readFileSync(new URL('../../conformance/markdown/cases.json', import.meta.url)))

for (const c of cases) {
  test(`markdown: ${c.name}`, () => {
    const blocks = parseMarkdown(c.markdown)
    assert.deepEqual(blocks, c.blocks)
    assert.equal(plainMarkdown(blocks), c.plain)
  })
}

test('links only for http, https and mailto', () => {
  for (const url of ['javascript:alert(1)', 'ftp://x.y/z', 'data:text/html,hi', 'JAVASCRIPT:alert(1)', '//evil.com']) {
    const spans = parseMarkdown(`[x](${url})`)[0].spans
    assert.ok(spans.every((s) => !('link' in s)), url)
  }
})

test('the markdown block: rendered when this SDK is new enough, the fallback otherwise', () => {
  const md = { type: 'markdown', text: 'Tap **Export**', fallback: 'Tap Export' }
  assert.deepEqual(parseBlock(md), { type: 'markdown', text: 'Tap **Export**', fallback: 'Tap Export' })
  // What the server sends: min_sdk 0.5.0. This build is 0.4.4 until the release bumps it.
  assert.deepEqual(parseBlock({ ...md, min_sdk: '0.5.0' }), { type: 'unsupported', fallback: 'Tap Export' })
  assert.deepEqual(parseBlock({ ...md, min_sdk: '0.4.4' }).type, 'markdown')
  // No fallback from the server: the parsed plain text, never raw `**`.
  assert.deepEqual(parseBlock({ type: 'markdown', text: '**Hi** [docs](https://a.b)' }), { type: 'markdown', text: '**Hi** [docs](https://a.b)', fallback: 'Hi docs (https://a.b)' })
  // No text: the fallback as plain text.
  assert.deepEqual(parseBlock({ type: 'markdown', fallback: 'Hi' }), { type: 'unsupported', fallback: 'Hi' })
})

test('previews are plain text: the fallback, never `**`', () => {
  const m = { id: 'm', author: 'admin', createdAt: '', blocks: [parseBlock({ type: 'markdown', text: '1. Open **Settings**', fallback: '1. Open Settings' })] }
  assert.equal(plainText(m), '1. Open Settings')
})
