// SDK 0.5.1 units (timeouts, unread reply first, continuing a topic): node --test tests/v051.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const out = await build({
  stdin: {
    contents: "export { ApiClient, DevReplyError, TIMEOUTS, timeoutSignal, openConversationIn, unreadReply, firstWords } from './src/api.ts'",
    resolveDir: '.',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  define: { __SDK_VERSION__: '"0.5.1"' },
})
const api = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text))
const { ApiClient, DevReplyError, TIMEOUTS, timeoutSignal, openConversationIn, unreadReply, firstWords } = api

// ---- timeouts ----

/** A fetch that never answers (a server that hangs), until the request's signal aborts it. */
function hangingFetch(calls) {
  return (url, init) => {
    calls.push({ url, init })
    return new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
  }
}

/** Node's AbortSignal.timeout doesn't hold the event loop open (browsers don't care): keep it alive. */
async function alive(fn) {
  const keep = setInterval(() => {}, 1_000)
  try {
    return await fn()
  } finally {
    clearInterval(keep)
  }
}

test('20 s for requests and 60 s for uploads, like the native SDKs', () => {
  assert.deepEqual(TIMEOUTS, { request: 20_000, upload: 60_000 })
})

test('a request that hangs fails as a network error after its timeout', () => alive(async () => {
  const calls = []
  globalThis.fetch = hangingFetch(calls)
  const client = new ApiClient('https://api.test', { request: 50, upload: 200 })
  const started = Date.now()
  await assert.rejects(client.profile('t'), (e) => e instanceof DevReplyError && e.kind === 'network')
  const took = Date.now() - started
  assert.ok(took >= 40 && took < 1_000, `took ${took} ms`)
  assert.equal(calls[0].url, 'https://api.test/v1/me')
  assert.ok(calls[0].init.signal, 'every request carries a signal')
}))

test('a body that stalls after the headers counts too', () => alive(async () => {
  globalThis.fetch = (_url, init) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    })
  const client = new ApiClient('https://api.test', { request: 50, upload: 200 })
  await assert.rejects(client.conversations('t'), (e) => e instanceof DevReplyError && e.kind === 'network')
}))

test('a quick answer is unaffected; a non-JSON body is still forgiven', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ name: 'Debra', email: null }) })
  const client = new ApiClient('https://api.test', { request: 50, upload: 200 })
  assert.deepEqual(await client.profile('t'), { name: 'Debra', email: null })
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => { throw new SyntaxError('html') } })
  await assert.rejects(client.profile('t'), (e) => e.kind === 'server' && e.status === 500)
})

test('uploads get the longer timeout', () => alive(async () => {
  const calls = []
  globalThis.fetch = (url, init) => {
    if (url.endsWith('/v1/attachments')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'a1', upload_url: 'https://s3.test/put' }) })
    return hangingFetch(calls)(url, init)
  }
  const client = new ApiClient('https://api.test', { request: 30, upload: 150 })
  const started = Date.now()
  await assert.rejects(client.upload('t', { kind: 'file', mime: 'text/plain', data: new Blob(['hi']) }), (e) => e.kind === 'network')
  const took = Date.now() - started
  assert.ok(took >= 130, `the PUT waited the upload timeout, took ${took} ms`)
  assert.equal(calls[0].url, 'https://s3.test/put')
}))

test('older browsers without AbortSignal.timeout: an AbortController and a timer', async () => {
  const original = AbortSignal.timeout
  try {
    AbortSignal.timeout = undefined
    const { signal, done } = timeoutSignal(30)
    assert.equal(signal.aborted, false)
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(signal.aborted, true)
    done()
    // `done` stops the timer: no abort after a quick answer.
    const quick = timeoutSignal(30)
    quick.done()
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(quick.signal.aborted, false)
    // And the client still times out with the fallback.
    globalThis.fetch = hangingFetch([])
    await assert.rejects(new ApiClient('https://api.test', { request: 30, upload: 30 }).profile('t'), (e) => e.kind === 'network')
  } finally {
    AbortSignal.timeout = original
  }
})

// ---- unread reply first, continuing a topic ----

const conv = (id, o = {}) => ({
  id,
  status: 'open',
  category: 'billing',
  lastText: 'Hi',
  lastAuthor: 'user',
  unread: 0,
  lastMessageAt: '2026-11-05T10:00:00Z',
  ...o,
})

test('a start topic continues the newest open conversation in it', () => {
  const list = [
    conv('old', { lastMessageAt: '2026-11-01T10:00:00Z' }),
    conv('new', { lastMessageAt: '2026-11-05T10:00:00Z' }),
    conv('bug', { category: 'bug', lastMessageAt: '2026-11-06T10:00:00Z' }),
  ]
  assert.equal(openConversationIn(list, 'billing').id, 'new')
  assert.equal(openConversationIn(list, 'bug').id, 'bug')
  assert.equal(openConversationIn(list, 'idea'), null)
})

test('resolved conversations are not continued: the topic starts a new one', () => {
  const list = [conv('done', { status: 'closed' }), conv('live-resolved', { status: 'resolved' })]
  assert.equal(openConversationIn(list, 'billing'), null)
  assert.equal(openConversationIn([...list, conv('waiting', { lastMessageAt: '2026-10-01T00:00:00Z' })], 'billing').id, 'waiting')
})

test('home puts the newest unread team reply first; the user\'s own or system lines never', () => {
  const list = [
    conv('read', { lastAuthor: 'admin' }),
    conv('mine', { unread: 1, lastAuthor: 'user' }),
    conv('system', { unread: 1, lastAuthor: 'system' }),
    conv('agent', { unread: 2, lastAuthor: 'agent', lastMessageAt: '2026-11-04T10:00:00Z' }),
    conv('admin', { unread: 1, lastAuthor: 'admin', lastMessageAt: '2026-11-05T09:00:00Z' }),
  ]
  assert.equal(unreadReply(list).id, 'admin')
  assert.equal(unreadReply(list.slice(0, 3)), null)
  assert.equal(unreadReply([]), null)
})

test('first words: one line, cut at a word', () => {
  assert.equal(firstWords('Hi Debra,\n\n  your refund is on its way.'), 'Hi Debra, your refund is on its way.')
  const long = 'Your refund for the yearly plan went out today and should reach your card within five to ten working days.'
  const short = firstWords(long, 40)
  assert.equal(short, 'Your refund for the yearly plan went…')
  assert.ok(Array.from(short).length <= 41)
  assert.equal(firstWords('x'.repeat(50), 10), 'xxxxxxxxxx…')
})
