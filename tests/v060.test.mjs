// SDK 0.6.0 units (link buttons, gifts, forms, offers; spec 14 "0.6 wire formats"): node --test tests/v060.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

/** The SDK's api and markdown modules, built as if this SDK were `version`. */
async function sdk(version) {
  const out = await build({
    stdin: {
      contents:
        "export * from './src/api.ts'; export { parseMarkdown, isSafeUrl } from './src/markdown.ts'",
      resolveDir: '.',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    define: { __SDK_VERSION__: JSON.stringify(version) },
  })
  return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text))
}
const api = await sdk('0.6.0')
const old = await sdk('0.5.1')

// ---- the spec's examples ----

const LINKS = {
  type: 'links',
  text: 'Markdown intro, optional',
  links: [{ id: 'l1', label: 'Open the new lessons', url: 'kneefit://lessons/new' }],
  min_sdk: '0.6.0',
  fallback: 'Markdown intro\n\nOpen the new lessons: kneefit://lessons/new',
}
const GIFT = {
  type: 'gift',
  gift_id: '7b1c2f0e-1d7a-4e8e-9a51-3c0f3c1d9a01',
  title: '50% off for a year',
  text: 'Thanks for finding that bug!',
  url: 'kneefit://paywall?offer=bug_hunter&devreply_gift=gft_0123456789abcdef0123456789abcdef',
  expires_at: '2026-11-25T10:00:00Z',
  min_sdk: '0.6.0',
  fallback: '🎁 50% off for a year. Thanks for finding that bug!\nOpen it: kneefit://paywall?…',
}
const QUESTIONS = [
  { id: 'q1', text: 'What stopped you?', kind: 'single', options: [{ id: 'o1', label: 'Price' }, { id: 'o2', label: 'Bugs' }], required: true },
  { id: 'q2', text: 'Which features matter?', kind: 'multi', options: [{ id: 'o1', label: 'Lessons' }, { id: 'o2', label: 'Reminders' }, { id: 'o3', label: 'Charts' }], required: false },
  { id: 'q3', text: 'Anything else?', kind: 'text', required: false },
]
const FORM = { type: 'form', text: 'Markdown intro, optional', questions: QUESTIONS, min_sdk: '0.6.0', fallback: '1. What stopped you?…\n\nReply in your own words.' }

test('0.6.0 blocks render on 0.6.0 and show their fallback on older SDKs', () => {
  assert.equal(api.SDK_VERSION, '0.6.0')
  for (const b of [LINKS, GIFT, FORM]) {
    assert.equal(api.parseBlock(b).type, b.type, b.type)
    assert.deepEqual(old.parseBlock(b), { type: 'unsupported', fallback: b.fallback }, b.type)
  }
  assert.deepEqual(api.parseBlock(LINKS), {
    type: 'links',
    text: 'Markdown intro, optional',
    links: [{ id: 'l1', label: 'Open the new lessons', url: 'kneefit://lessons/new' }],
    fallback: LINKS.fallback,
  })
  assert.deepEqual(api.parseBlock(GIFT), {
    type: 'gift',
    giftId: GIFT.gift_id,
    title: GIFT.title,
    text: GIFT.text,
    url: GIFT.url,
    expiresAt: GIFT.expires_at,
    fallback: GIFT.fallback,
  })
  // Decoded questions always have `options` (none for text).
  const decoded = QUESTIONS.map((q) => ({ ...q, options: q.options ?? [] }))
  assert.deepEqual(api.parseBlock(FORM), { type: 'form', text: FORM.text, questions: decoded, fallback: FORM.fallback })
  // A future block type still shows its fallback on 0.6.0.
  assert.deepEqual(api.parseBlock({ type: 'carousel', min_sdk: '0.7.0', fallback: 'x' }), { type: 'unsupported', fallback: 'x' })
})

test('links: forgiving; 1 to 3, labels trimmed to 40 characters, none shows the fallback', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, label: `L${i}`, url: 'https://a.b' }))
  assert.equal(api.parseBlock({ ...LINKS, links: many }).links.length, 3)
  const long = api.parseBlock({ ...LINKS, links: [{ id: 'l1', label: `  ${'x'.repeat(50)}  `, url: 'https://a.b' }] })
  assert.equal(long.links[0].label, 'x'.repeat(40))
  const messy = [{ id: 'l1', label: 'A', url: 'https://a.b' }, { id: 'l2', label: ' ', url: 'https://a.b' }, { id: 'l3', label: 'C' }, null, 'x']
  assert.deepEqual(api.parseBlock({ ...LINKS, links: messy }).links.map((l) => l.id), ['l1'])
  assert.deepEqual(api.parseBlock({ ...LINKS, links: [] }), { type: 'unsupported', fallback: LINKS.fallback })
  // No intro: null; no fallback from the server: the labels and URLs.
  const bare = api.parseBlock({ type: 'links', links: [{ id: 'l1', label: 'Open', url: 'kneefit://x' }] })
  assert.equal(bare.text, null)
  assert.equal(bare.fallback, 'Open: kneefit://x')
})

test('gift: needs an id, a title and a URL; a bad expiry counts as none', () => {
  assert.deepEqual(api.parseBlock({ ...GIFT, gift_id: null }), { type: 'unsupported', fallback: GIFT.fallback })
  assert.deepEqual(api.parseBlock({ ...GIFT, title: ' ' }), { type: 'unsupported', fallback: GIFT.fallback })
  assert.deepEqual(api.parseBlock({ ...GIFT, url: undefined }), { type: 'unsupported', fallback: GIFT.fallback })
  assert.equal(api.parseBlock({ ...GIFT, expires_at: 'soon' }).expiresAt, null)
  assert.equal(api.parseBlock({ ...GIFT, text: undefined }).text, '')
  const m = api.parseMessage({ id: 'g', author: 'admin', created_at: '2026-11-11T10:00:00Z', blocks: [GIFT] })
  assert.equal(api.plainText(m), '🎁 50% off for a year')
})

test('form: a question this SDK cannot show makes the whole form its fallback', () => {
  const fb = { type: 'unsupported', fallback: FORM.fallback }
  assert.deepEqual(api.parseBlock({ ...FORM, questions: [...QUESTIONS, { id: 'q4', text: 'Rate us', kind: 'stars', required: false }] }), fb)
  assert.deepEqual(api.parseBlock({ ...FORM, questions: [{ ...QUESTIONS[0], options: [{ id: 'o1', label: 'Only one' }] }] }), fb)
  assert.deepEqual(api.parseBlock({ ...FORM, questions: [QUESTIONS[0], { ...QUESTIONS[1], id: 'q1' }] }), fb)
  assert.deepEqual(api.parseBlock({ ...FORM, questions: [] }), fb)
  assert.deepEqual(api.parseBlock({ ...FORM, questions: 'nope' }), fb)
  // At most 5 questions and 6 options; `required` only when true.
  const six = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, text: `Q${i}`, kind: 'text' }))
  assert.equal(api.parseBlock({ ...FORM, questions: six }).questions.length, 5)
  const opts = Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, label: `O${i}` }))
  const q = api.parseBlock({ ...FORM, questions: [{ id: 'q1', text: 'Q', kind: 'multi', options: opts, required: 'yes' }] }).questions[0]
  assert.equal(q.options.length, 6)
  assert.equal(q.required, false)
  assert.equal(api.parseBlock({ ...FORM, text: '' }).text, null)
})

test('form answers: required ones checked, encoded as the server takes them', () => {
  const qs = api.parseBlock(FORM).questions
  assert.deepEqual(api.missingAnswers(qs, {}), ['q1'])
  assert.deepEqual(api.missingAnswers(qs, { q1: 'nope' }), ['q1'])
  assert.deepEqual(api.missingAnswers(qs, { q1: 'o2' }), [])
  const required = qs.map((x) => ({ ...x, required: true }))
  assert.deepEqual(api.missingAnswers(required, { q1: 'o1', q2: [], q3: '   ' }), ['q2', 'q3'])
  assert.deepEqual(api.missingAnswers(required, { q1: 'o1', q2: ['o9'], q3: 'x' }), ['q2'])
  // single: the option id; multi: ids in the form's order, unknown ones left out; text: trimmed.
  assert.deepEqual(api.encodeFormAnswers(qs, { q1: 'o1', q2: ['o3', 'o9', 'o1'], q3: '  free text ' }), { q1: 'o1', q2: ['o1', 'o3'], q3: 'free text' })
  // Unanswered (and empty) ones are left out.
  assert.deepEqual(api.encodeFormAnswers(qs, { q1: 'o2', q2: [], q3: ' ' }), { q1: 'o2' })
  assert.deepEqual(api.encodeFormAnswers(qs, { q1: 'o7' }), {})
  assert.equal(Array.from(api.encodeFormAnswers(qs, { q3: '🙂'.repeat(2100) }).q3).length, 2000)
})

test("the user's answer message carries the form answer (on the message or its block)", () => {
  const fa = { message_id: 'f1', answers: { q1: 'o1', q2: ['o1', 'o3'], q3: 'free text', bad: 7 } }
  const want = { messageId: 'f1', answers: { q1: 'o1', q2: ['o1', 'o3'], q3: 'free text' } }
  const base = { id: 'u1', author: 'user', created_at: '2026-11-11T10:01:00Z' }
  assert.deepEqual(api.parseMessage({ ...base, blocks: [{ type: 'text', text: 'What stopped you? Price', form_answer: fa }] }).formAnswer, want)
  assert.deepEqual(api.parseMessage({ ...base, form_answer: fa, blocks: [{ type: 'text', text: 'x' }] }).formAnswer, want)
  // A block of its own kind shows its summary.
  const own = api.parseMessage({ ...base, blocks: [{ type: 'form_answer', text: 'What stopped you? Price', form_answer: fa }] })
  assert.deepEqual(own.blocks, [{ type: 'text', text: 'What stopped you? Price' }])
  assert.equal(api.parseMessage({ ...base, author: 'admin', form_answer: fa, blocks: [] }).formAnswer, undefined)
  assert.equal(api.parseFormAnswer({ answers: {} }), null)
})

test('promotional: team messages only', () => {
  const m = (o) => api.parseMessage({ id: 'p', created_at: '2026-11-11T10:00:00Z', blocks: [{ type: 'text', text: 'Sale' }], ...o })
  assert.equal(m({ author: 'admin', promotional: true }).promotional, true)
  assert.equal(m({ author: 'agent', promotional: true }).promotional, true)
  assert.equal(m({ author: 'admin', promotional: false }).promotional, undefined)
  assert.equal(m({ author: 'admin', promotional: 'yes' }).promotional, undefined)
  assert.equal(m({ author: 'user', promotional: true }).promotional, undefined)
})

// ---- URL allow-list ----

test('link_schemes from the config: lowercase app schemes only', () => {
  const c = api.parseConfig({ link_schemes: ['kneefit', 'KneeFit2', 'com.example.app', 'javascript', 'data', 'http', 'https', 'bad scheme', '1abc', 7, null] }, 'App')
  assert.deepEqual(c.linkSchemes, ['kneefit', 'kneefit2', 'com.example.app'])
  assert.deepEqual(api.parseConfig({}, 'App').linkSchemes, [])
  assert.deepEqual(api.parseConfig({ link_schemes: 'kneefit' }, 'App').linkSchemes, [])
  assert.deepEqual(api.placeholderConfig('App').linkSchemes, [])
})

test('linkTarget: https in a new tab, the app scheme in place, nothing else', () => {
  const schemes = ['kneefit']
  assert.equal(api.linkTarget('https://devreply.com/x?a=1', schemes), 'tab')
  assert.equal(api.linkTarget('HTTPS://devreply.com', schemes), 'tab')
  assert.equal(api.linkTarget('kneefit://lessons/new', schemes), 'app')
  assert.equal(api.linkTarget('KneeFit://lessons', schemes), 'app')
  assert.equal(api.linkTarget('kneefit:lessons', schemes), 'app')
  for (const url of [
    'http://devreply.com',
    'otherapp://x',
    'kneefitx://x',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,hi',
    'vbscript:x',
    'file:///etc/passwd',
    'blob:https://a/b',
    '//evil.com',
    '/relative',
    'https://',
    'https://a b',
    'mailto:a@b.c',
    '',
  ])
    assert.equal(api.linkTarget(url, schemes), null, url)
  // Without the app's schemes (no config yet), only https.
  assert.equal(api.linkTarget('kneefit://x', []), null)
  // A config can never allow a dangerous scheme.
  assert.equal(api.linkTarget('javascript:alert(1)', ['javascript']), null)
  assert.equal(api.linkTarget('data:,x', ['data']), null)
})

test('Markdown links: the app scheme only when passed; the conformance default stays http(s) and mailto', () => {
  const link = (md, schemes) => api.parseMarkdown(md, schemes)[0].spans.find((s) => s.link)?.link
  assert.equal(link('[lessons](kneefit://lessons)'), undefined)
  assert.equal(link('[lessons](kneefit://lessons)', ['kneefit']), 'kneefit://lessons')
  assert.equal(link('**[lessons](kneefit://lessons)**', ['kneefit']), 'kneefit://lessons')
  assert.equal(api.parseMarkdown('- [lessons](kneefit://lessons)', ['kneefit'])[0].items[0][0].link, 'kneefit://lessons')
  assert.equal(link('[x](otherapp://x)', ['kneefit']), undefined)
  assert.equal(link('[x](javascript:alert(1))', ['kneefit']), undefined)
  assert.equal(api.isSafeUrl('kneefit://x'), false)
  assert.equal(api.isSafeUrl('KNEEFIT://x', ['kneefit']), true)
  assert.equal(api.isSafeUrl('kneefitx://x', ['kneefit']), false)
})

// ---- requests ----

function recording(status = 204, body = '') {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization })
    return new Response(status === 204 ? null : body, { status })
  }
  return calls
}

test('taps, gift opens, form answers and the offers choice: the spec requests', async () => {
  const client = new api.ApiClient('https://api.test/')
  let calls = recording()
  await client.tap('it_x', 'c1', 'm1', 'l1')
  await client.giftOpened('it_x', '7b1c2f0e-1d7a-4e8e-9a51-3c0f3c1d9a01')
  assert.deepEqual(calls, [
    { url: 'https://api.test/v1/conversations/c1/taps', method: 'POST', body: { message_id: 'm1', link_id: 'l1' }, auth: 'Bearer it_x' },
    { url: 'https://api.test/v1/gifts/7b1c2f0e-1d7a-4e8e-9a51-3c0f3c1d9a01/opened', method: 'POST', body: undefined, auth: 'Bearer it_x' },
  ])

  const reply = { id: 'u1', author: 'user', created_at: '2026-11-11T10:01:00Z', blocks: [{ type: 'text', text: 'What stopped you? Price', form_answer: { message_id: 'm2', answers: { q1: 'o1' } } }] }
  calls = recording(200, JSON.stringify(reply))
  const m = await client.answerForm('it_x', 'c1', 'm2', { q1: 'o1', q2: ['o1', 'o3'], q3: 'free text' })
  assert.deepEqual(calls[0].body, { form_answer: { message_id: 'm2', answers: { q1: 'o1', q2: ['o1', 'o3'], q3: 'free text' } } })
  assert.equal(calls[0].url, 'https://api.test/v1/conversations/c1/messages')
  assert.deepEqual(m.formAnswer, { messageId: 'm2', answers: { q1: 'o1' } })

  recording(409, JSON.stringify({ error: { message: 'already answered' } }))
  await assert.rejects(client.answerForm('it_x', 'c1', 'm2', { q1: 'o1' }), (e) => e.kind === 'conflict')
  recording(400, JSON.stringify({ error: { message: 'q1 is required' } }))
  await assert.rejects(client.answerForm('it_x', 'c1', 'm2', {}), (e) => e.kind === 'invalid' && e.message === 'q1 is required')

  calls = recording(200, JSON.stringify({ name: 'Debra', email: null, user_id: null, no_promotions: true }))
  const p = await client.updateProfile('it_x', { no_promotions: true })
  assert.deepEqual(calls[0].body, { attributes: {}, no_promotions: true })
  assert.equal(calls[0].method, 'PATCH')
  assert.equal(p.noPromotions, true)

  recording(200, JSON.stringify({ name: 'Debra', email: null, no_promotions: false }))
  assert.equal((await client.profile('it_x')).noPromotions, false)
  recording(200, JSON.stringify({ name: 'Debra', email: null }))
  assert.equal((await client.profile('it_x')).noPromotions, false)
})
