// SDK 0.5.0 units (live updates over WebSocket, spec 05): node --test tests/live.test.mjs
// The state machine with a fake WebSocket and a fake clock, and what a live message does to the store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

globalThis.window = globalThis
const out = await build({
  stdin: {
    contents: "export { Live, RECONNECT_DELAYS, MAX_FAILURES } from './src/live.ts'; export { store, ConversationModel } from './src/store.ts'; export { DevReplyError, parseMessage } from './src/api.ts'",
    resolveDir: '.',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { __SDK_VERSION__: '"0.5.0"' },
})
const { Live, RECONNECT_DELAYS, MAX_FAILURES, store, ConversationModel, DevReplyError, parseMessage } = await import(
  'data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text)
)

class FakeSocket {
  static all = []
  readyState = 0
  sent = []
  closedWith = null
  onopen = null
  onmessage = null
  onclose = null
  onerror = null
  constructor(url) {
    this.url = url
    FakeSocket.all.push(this)
  }
  send(data) {
    this.sent.push(JSON.parse(data))
  }
  close(code) {
    this.closedWith = code
    this.readyState = 3
  }
  // what the server does
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  frame(v) {
    this.onmessage?.({ data: typeof v === 'string' ? v : JSON.stringify(v) })
  }
  drop() {
    this.readyState = 3
    this.onerror?.({})
    this.onclose?.({ code: 1006 })
  }
}

const ID1 = '01928a3b-0000-7000-8000-000000000001'
const ID2 = '01928a3b-0000-7000-8000-000000000002'
const CONV = '00000000-0000-4000-8000-00000000abcd'
const msg = (id, author = 'admin', text = 'Hi', at = '2026-09-30T10:00:00Z') => ({ id, author, created_at: at, blocks: [{ type: 'text', text }] })

/** A Live with a fake clock and socket; `ticket` answers with the given results in order. */
function harness(tickets = []) {
  FakeSocket.all = []
  const h = { now: 0, timers: [], messages: [], changes: [], ticketCalls: 0 }
  h.live = new Live({
    ticket: async () => {
      h.ticketCalls++
      const next = tickets.length ? tickets.shift() : 'ok'
      if (next instanceof Error) throw next
      return 'ws://api.test/v1/live/ws?ticket=lt_x'
    },
    onMessage: (c, m) => h.messages.push([c, m]),
    onChange: (live) => h.changes.push(live),
    socket: (url) => new FakeSocket(url),
    setTimeout: (fn, ms) => {
      const t = { fn, at: h.now + ms, ms }
      h.timers.push(t)
      return t
    },
    clearTimeout: (t) => (h.timers = h.timers.filter((x) => x !== t)),
    random: () => 0.5,
    now: () => h.now,
  })
  h.sock = () => FakeSocket.all[FakeSocket.all.length - 1]
  /** Runs the next timer (advancing the clock) and lets the ticket promise settle. */
  h.tick = async () => {
    const t = h.timers.shift()
    assert.ok(t, 'a timer is scheduled')
    h.now = t.at
    t.fn()
    await settle()
    return t.ms
  }
  return h
}
const settle = () => new Promise((r) => setImmediate(r))

test('connect: ticket, socket, ready = live; frames go through; unknown types are ignored', async () => {
  const h = harness()
  h.live.start()
  assert.equal(h.live.state, 'connecting')
  await settle()
  const ws = h.sock()
  assert.equal(ws.url, 'ws://api.test/v1/live/ws?ticket=lt_x')
  ws.open()
  assert.equal(h.live.isLive, false, 'not live before ready')
  ws.frame({ type: 'hello', whatever: 1 })
  ws.frame('not json')
  ws.frame({ type: 'ready' })
  assert.equal(h.live.isLive, true)
  assert.deepEqual(h.changes, [true])
  ws.frame({ type: 'message', id: ID1, conversation_id: CONV, message: msg(ID1) })
  ws.frame({ type: 'message', conversation_id: CONV, message: { nope: true } })
  assert.equal(h.messages.length, 1)
  assert.equal(h.messages[0][0], CONV)
  assert.equal(h.messages[0][1].id, ID1)
  assert.equal(h.live.lastSeen, ID1)
  h.live.read(CONV)
  assert.deepEqual(ws.sent, [{ type: 'read', conversation_id: CONV }])
})

test('isLive also needs the socket OPEN', async () => {
  const h = harness()
  h.live.start()
  await settle()
  h.sock().open()
  h.sock().frame({ type: 'ready' })
  h.sock().readyState = 2 // closing, the close event not here yet
  assert.equal(h.live.isLive, false)
})

test('reconnect uses after = the newest message id seen', async () => {
  const h = harness()
  h.live.saw(ID2)
  h.live.saw(ID1) // older: ignored
  h.live.saw('not-a-v7-id')
  h.live.start()
  await settle()
  assert.equal(h.sock().url, `ws://api.test/v1/live/ws?ticket=lt_x&after=${ID2}`)
})

test('normal close: stop closes with 1000 and never reconnects', async () => {
  const h = harness()
  h.live.start()
  await settle()
  const ws = h.sock()
  ws.open()
  ws.frame({ type: 'ready' })
  h.live.stop()
  assert.equal(ws.closedWith, 1000)
  assert.equal(h.live.state, 'off')
  assert.deepEqual(h.changes, [true, false])
  assert.equal(h.timers.length, 0)
  ws.frame({ type: 'message', id: ID1, conversation_id: CONV, message: msg(ID1) })
  assert.equal(h.messages.length, 0, 'a closed socket delivers nothing')
})

test('stop while the ticket is on its way: no socket opens', async () => {
  const h = harness()
  h.live.start()
  h.live.stop()
  await settle()
  assert.equal(FakeSocket.all.length, 0)
})

test('backoff: a healthy drop waits 1 s, then 2, 4, 8, 16 s (±20%); 5 failures in a row: polling', async () => {
  const h = harness()
  h.live.start()
  await settle()
  h.sock().open()
  h.sock().frame({ type: 'ready' })
  h.now += 60_000
  h.sock().drop()
  assert.equal(h.live.state, 'waiting')
  assert.deepEqual(h.changes, [true, false])
  const waits = [await h.tick()]
  for (let i = 0; i < 4; i++) {
    h.sock().drop() // never reaches ready
    waits.push(await h.tick())
  }
  assert.deepEqual(waits, [1_000, 2_000, 4_000, 8_000, 16_000])
  assert.equal(h.ticketCalls, 6)
  h.sock().drop()
  assert.equal(h.live.state, 'polling')
  assert.equal(h.timers.length, 0)
  // Hidden and back: still polling. Opened again: live again.
  h.live.stop()
  h.live.start()
  assert.equal(h.ticketCalls, 6)
  h.live.rearm()
  h.live.start()
  await settle()
  assert.equal(h.ticketCalls, 7)
  assert.equal(RECONNECT_DELAYS[5], 30_000)
  assert.equal(MAX_FAILURES, 5)
})

test('jitter stays within ±20%', async () => {
  for (const [r, want] of [[0, 800], [0.999999, 1_200]]) {
    const h = harness()
    h.live.deps.random = () => r
    h.live.start()
    await settle()
    h.sock().open()
    h.sock().frame({ type: 'ready' })
    h.now += 60_000
    h.sock().drop()
    assert.equal(h.timers[0].ms, want)
  }
})

test('a drop soon after ready counts as a failure (no 1 s reconnect loop)', async () => {
  const h = harness()
  h.live.start()
  await settle()
  h.sock().open()
  h.sock().frame({ type: 'ready' })
  h.now += 5_000
  h.sock().drop()
  assert.equal(h.live.failures, 1)
  assert.equal(h.timers[0].ms, 2_000)
})

test('a failed ticket counts; ready after a healthy spell resets the count', async () => {
  const h = harness([new DevReplyError('network'), new DevReplyError('server', 'x', 500)])
  h.live.start()
  await settle()
  assert.equal(h.live.failures, 1)
  assert.equal(await h.tick(), 2_000)
  assert.equal(h.live.failures, 2)
  assert.equal(await h.tick(), 4_000)
  h.sock().open()
  h.sock().frame({ type: 'ready' })
  h.now += 31_000
  h.sock().drop()
  assert.equal(h.live.failures, 0)
  assert.equal(h.timers[0].ms, 1_000)
})

test('503: live is off, polling at once until the messenger opens again', async () => {
  const h = harness([new DevReplyError('unavailable', 'off', 503)])
  h.live.start()
  await settle()
  assert.equal(h.live.state, 'polling')
  assert.equal(FakeSocket.all.length, 0)
  assert.equal(h.timers.length, 0)
})

test('a URL that is not ws(s) is refused', async () => {
  const h = harness()
  h.live.deps.ticket = async () => 'javascript:alert(1)'
  h.live.start()
  await settle()
  assert.equal(FakeSocket.all.length, 0)
  assert.equal(h.live.failures, 1)
})

// ---- what a live message does to the store and an open thread ----

function freshStore() {
  store.live.reset()
  store.conversations = [{ id: CONV, status: 'open', category: 'bug', lastText: 'Export broken', lastAuthor: 'user', unread: 0, lastMessageAt: '2026-09-30T09:00:00Z' }]
  store.isOpen = true
  store.visibleConversation = null
  const reads = []
  store.live.read = (c) => reads.push(c)
  return reads
}

test('store: a team reply updates the list and unread like a poll; on screen it is read instead', () => {
  const reads = freshStore()
  store.liveMessage(CONV, parseMessage(msg(ID1, 'admin', 'Fixed in 2.1')))
  const c = store.conversations[0]
  assert.equal(c.lastText, 'Fixed in 2.1')
  assert.equal(c.lastAuthor, 'admin')
  assert.equal(c.unread, 1)
  assert.equal(store.unreadCount, 1)
  // The same message again (a backlog after reconnect): nothing changes.
  store.liveMessage(CONV, parseMessage(msg(ID1, 'admin', 'Fixed in 2.1')))
  assert.equal(store.conversations[0].unread, 1)
  // Older than the list: ignored.
  store.liveMessage(CONV, parseMessage(msg('01928a3b-0000-7000-8000-000000000000', 'admin', 'old', '2026-09-30T08:00:00Z')))
  assert.equal(store.conversations[0].lastText, 'Fixed in 2.1')
  assert.deepEqual(reads, [])
  store.visibleConversation = CONV
  store.liveMessage(CONV, parseMessage(msg(ID2, 'agent', 'Try now', '2026-09-30T10:05:00Z')))
  assert.equal(store.conversations[0].unread, 0)
  assert.deepEqual(reads, [CONV])
  store.liveMessage(CONV, parseMessage({ id: '01928a3b-0000-7000-8000-000000000003', author: 'system', created_at: '2026-09-30T10:06:00Z', blocks: [{ type: 'text', text: 'Resolved', key: 'resolved' }] }))
  assert.equal(store.conversations[0].status, 'resolved')
})

test('store: a message in a conversation the list lacks reloads the list', async () => {
  freshStore()
  let refreshed = 0
  const original = store.refresh
  store.refresh = async () => void refreshed++
  store.liveMessage('00000000-0000-4000-8000-00000000ffff', parseMessage(msg(ID1)))
  store.liveMessage('00000000-0000-4000-8000-00000000ffff', parseMessage(msg(ID2)))
  await new Promise((r) => setTimeout(r, 350))
  store.refresh = original
  assert.equal(refreshed, 1, 'debounced into one reload')
})

test('thread: live messages go in once, in order, and replace the matching pending bubble', () => {
  freshStore()
  const model = new ConversationModel(CONV, 'bug')
  const other = new ConversationModel('00000000-0000-4000-8000-00000000ffff', 'bug')
  const detach = store.attach(model)
  const detachOther = store.attach(other)
  model.messages = [parseMessage(msg('01928a3b-0000-7000-8000-000000000000', 'user', 'Export broken', '2026-09-30T09:00:00Z'))]
  model.pending = [
    { id: 'p1', text: 'Still broken', attachments: [], failure: null },
    { id: 'p2', text: 'Still broken', attachments: [], failure: null },
  ]
  store.liveMessage(CONV, parseMessage(msg(ID2, 'admin', 'Looking', '2026-09-30T10:02:00Z')))
  store.liveMessage(CONV, parseMessage(msg(ID1, 'user', 'Still broken', '2026-09-30T10:01:00Z')))
  store.liveMessage(CONV, parseMessage(msg(ID1, 'user', 'Still broken', '2026-09-30T10:01:00Z')))
  assert.deepEqual(model.messages.map((m) => m.id), ['01928a3b-0000-7000-8000-000000000000', ID1, ID2])
  assert.deepEqual(model.pending.map((p) => p.id), ['p2'], 'only the first matching pending one goes')
  assert.equal(other.messages.length, 0, 'other conversations get nothing')
  detach()
  detachOther()
  store.liveMessage(CONV, parseMessage(msg('01928a3b-0000-7000-8000-000000000009', 'admin', 'After', '2026-09-30T10:09:00Z')))
  assert.equal(model.messages.length, 3, 'a closed screen gets nothing')
})
