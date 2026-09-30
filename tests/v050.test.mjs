// SDK 0.5.0 units (button replies): node --test tests/v050.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const out = await build({
  stdin: { contents: "export { parseBlock, parseMessage, parseAnswer, plainText } from './src/api.ts'", resolveDir: '.', loader: 'ts' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  define: { __SDK_VERSION__: '"0.4.4"' },
})
const { parseBlock, parseMessage, parseAnswer, plainText } = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text))

const options = [
  { id: 'o1', label: 'Too expensive' },
  { id: 'o2', label: 'Missing a feature' },
  { id: 'o3', label: 'Something else' },
]
const FALLBACK = 'Why did you cancel?\n\n1. Too expensive\n2. Missing a feature\n3. Something else\n\nReply with a number or in your own words.'
const block = { type: 'buttons', text: 'Why did you **cancel**?', options, fallback: FALLBACK }

test('buttons: decoded when this SDK is new enough; the fallback otherwise (min_sdk 0.5.0, this build 0.4.4)', () => {
  assert.deepEqual(parseBlock(block), { type: 'buttons', text: 'Why did you **cancel**?', options, fallback: FALLBACK })
  assert.deepEqual(parseBlock({ ...block, min_sdk: '0.5.0' }), { type: 'unsupported', fallback: FALLBACK })
  assert.equal(parseBlock({ ...block, min_sdk: '0.4.4' }).type, 'buttons')
})

test('buttons: forgiving; bad options skipped, at most 5, fewer than 2 shows the fallback', () => {
  const messy = [{ id: 'o1', label: 'A' }, { id: 7, label: 'bad id' }, { label: 'no id' }, { id: 'o2', label: '  ' }, null, { id: 'o3', label: 'B' }]
  assert.deepEqual(parseBlock({ ...block, options: messy }).options, [{ id: 'o1', label: 'A' }, { id: 'o3', label: 'B' }])
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, label: `L${i}` }))
  assert.equal(parseBlock({ ...block, options: many }).options.length, 5)
  assert.deepEqual(parseBlock({ ...block, options: [options[0]] }), { type: 'unsupported', fallback: FALLBACK })
  assert.deepEqual(parseBlock({ ...block, text: '' }), { type: 'unsupported', fallback: FALLBACK })
  assert.deepEqual(parseBlock({ ...block, options: 'nope' }).type, 'unsupported')
  // No fallback from the server: the plain question and the numbered options, never `**`.
  const { fallback } = parseBlock({ type: 'buttons', text: 'Why did you **cancel**?', options: options.slice(0, 2) })
  assert.equal(fallback, 'Why did you cancel?\n\n1. Too expensive\n2. Missing a feature')
})

test('previews use the question as plain text', () => {
  const m = parseMessage({ id: 'q1', author: 'agent', created_at: '2026-09-30T10:00:00Z', blocks: [block] })
  assert.equal(plainText(m), 'Why did you cancel?')
})

test('an answer on the user message or on its block; team messages never carry one', () => {
  const answer = { message_id: 'q1', option_id: 'o2' }
  const base = { id: 'u1', author: 'user', created_at: '2026-09-30T10:01:00Z', blocks: [{ type: 'text', text: 'Missing a feature' }] }
  assert.deepEqual(parseMessage({ ...base, answer }).answer, { messageId: 'q1', optionId: 'o2' })
  assert.deepEqual(parseMessage({ ...base, blocks: [{ type: 'text', text: 'Missing a feature', answer }] }).answer, { messageId: 'q1', optionId: 'o2' })
  assert.equal(parseMessage(base).answer, undefined)
  assert.equal(parseMessage({ ...base, author: 'admin', answer }).answer, undefined)
  assert.equal(parseAnswer({ message_id: 'q1' }), null)
  assert.equal(parseAnswer('x'), null)
})
