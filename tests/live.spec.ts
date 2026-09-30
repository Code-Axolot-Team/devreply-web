import { join } from 'node:path'
import { type Page, type Route, type WebSocketRoute, expect, test } from '@playwright/test'

// SDK 0.5.0: live updates over WebSocket (spec 05), against a stubbed API (page.route) and a faked live
// socket (page.routeWebSocket), so it runs without a key. DEVREPLY_SHOTS: a folder for the screenshots.
const shots = process.env.DEVREPLY_SHOTS ?? ''
const PK = 'pk_stub_0000000000000000'
const API = '/stub'
const ID = '00000000-0000-4000-8000-00000000abcd'

type Json = Record<string, unknown>
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
let seq = 0
/** A UUID v7-shaped id, increasing (the server's message ids are time-ordered). */
const v7 = () => `01928a3b-${(++seq).toString(16).padStart(4, '0')}-7000-8000-000000000000`

interface Stub {
  messageGets: number
  tickets: number
  /** POST /v1/live answers 503 (live off). */
  liveOff: boolean
  sent: Json[]
  conversations: Json[]
  messages: Json[]
  /** Every socket the SDK opened, and what it sent / how it closed. */
  sockets: { url: string; frames: Json[]; closed: number | null; route: WebSocketRoute }[]
  /** Called with each user message the SDK posts, before the POST answers (to race it with the socket). */
  beforeSendAnswer?: (message: Json) => Promise<void>
}

async function stub(page: Page, init: Partial<Stub> = {}): Promise<Stub> {
  const s: Stub = { messageGets: 0, tickets: 0, liveOff: false, sent: [], conversations: [], messages: [], sockets: [], ...init }
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**${API}/v1/**`, async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.slice(API.length)
    const method = req.method()
    if (method === 'POST' && path === '/v1/installs') return json(route, { token: 'tok_1' }, 201)
    if (method === 'POST' && path === '/v1/live') {
      s.tickets++
      if (s.liveOff) return json(route, { error: { code: 'unavailable', message: 'live updates are off right now: poll instead' } }, 503)
      return json(route, { url: `ws://localhost:4455${API}/v1/live/ws?ticket=lt_${s.tickets}`, expires_in: 60 })
    }
    if (method === 'GET' && path === '/v1/messenger/config')
      return json(route, { app_name: 'Fox Notes', team_name: 'Fox Notes', reply_time: 'Usually replies within a day', enabled: true, team: [] })
    if (method === 'GET' && path === '/v1/conversations') return json(route, s.conversations)
    if (method === 'GET' && path === '/v1/me') return json(route, { name: 'Ana', email: 'ana@example.com' })
    if (method === 'PATCH' && path === '/v1/me') return json(route, { name: 'Ana', email: 'ana@example.com' })
    if (path === `/v1/conversations/${ID}/messages`) {
      if (method === 'POST') {
        const body = req.postDataJSON() as Json
        s.sent.push(body)
        const message = { id: v7(), author: 'user', created_at: new Date().toISOString(), blocks: [{ type: 'text', text: body.text }] }
        s.messages.push(message)
        await s.beforeSendAnswer?.(message)
        return json(route, message, 201)
      }
      s.messageGets++
      return json(route, { conversation: s.conversations[0] ?? null, messages: s.messages })
    }
    return route.fulfill({ status: 204 })
  })
  await page.routeWebSocket(`**${API}/v1/live/ws**`, (ws) => {
    const entry = { url: ws.url(), frames: [] as Json[], closed: null as number | null, route: ws }
    s.sockets.push(entry)
    ws.onMessage((m) => entry.frames.push(JSON.parse(String(m))))
    ws.onClose((code) => {
      entry.closed = code ?? 1005
    })
    // What the server does: the backlog after `after`, then ready.
    const after = new URL(ws.url()).searchParams.get('after')
    if (after) for (const m of s.messages) if (String(m.id) > after) ws.send(JSON.stringify({ type: 'message', id: m.id, conversation_id: ID, message: m }))
    ws.send(JSON.stringify({ type: 'ready' }))
  })
  return s
}

function conversation(): Pick<Stub, 'conversations' | 'messages'> {
  return {
    conversations: [{ id: ID, status: 'open', category: 'bug', last_text: 'The export button does nothing', last_author: 'user', unread: 0, last_message_at: ago(5) }],
    messages: [{ id: v7(), author: 'user', created_at: ago(5), blocks: [{ type: 'text', text: 'The export button does nothing' }] }],
  }
}

/** The team replies: stored (what a poll would see) and pushed down every open socket. */
function teamSays(s: Stub, text: string, push = true): Json {
  const m = { id: v7(), author: 'admin', created_at: new Date().toISOString(), blocks: [{ type: 'text', text }], persona: { name: 'Dana', title: 'Support', avatar_url: null } }
  s.messages.push(m)
  const c = s.conversations[0] as Json
  Object.assign(c, { last_text: text, last_author: 'admin', last_message_at: m.created_at })
  if (push) for (const k of s.sockets) if (k.closed === null) k.route.send(JSON.stringify({ type: 'message', id: m.id, conversation_id: ID, message: m }))
  return m
}

const open = (s: Stub) => s.sockets.filter((k) => k.closed === null)

async function openChat(page: Page) {
  await page.goto(`/?key=${PK}&api=${API}`)
  await expect.poll(() => page.evaluate(() => 'DevReply' in window)).toBe(true)
  await page.getByTestId('devreply.launcher').click()
  await page.locator('.conv').first().click()
  await expect(page.getByTestId('devreply.composer')).toBeVisible()
  await page.getByTestId('devreply.composer').blur()
}

async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: join(shots, name), animations: 'disabled' })
}

test('live: a team reply shows at once, the 3 s poll pauses, the reply is marked read over the socket @smoke', async ({ page }) => {
  const s = await stub(page, conversation())
  await openChat(page)
  await expect.poll(() => open(s).length).toBe(1)
  expect(s.sockets[0].url).toContain('ticket=lt_')
  // Connected, caught up: from here, no polling.
  await page.waitForTimeout(500)
  const gets = s.messageGets
  const sentAt = Date.now()
  teamSays(s, 'Thanks! Fixed in 2.1, try again?')
  await expect(page.locator('.bubble', { hasText: 'Fixed in 2.1' })).toBeVisible({ timeout: 1_000 })
  expect(Date.now() - sentAt).toBeLessThan(1_000)
  await expect.poll(() => s.sockets[0].frames).toContainEqual({ type: 'read', conversation_id: ID })
  // A newer server's event: ignored.
  s.sockets[0].route.send(JSON.stringify({ type: 'typing', conversation_id: ID }))
  await page.waitForTimeout(4_000)
  expect(s.messageGets, 'no poll while live').toBe(gets)
  await expect(page.locator('.bubble')).toHaveCount(2)
  await shot(page, 'web-live-reply.png')
})

test('live: the socket beating the POST answer never shows the message twice', async ({ page }) => {
  const s = await stub(page, conversation())
  await openChat(page)
  await expect.poll(() => open(s).length).toBe(1)
  s.beforeSendAnswer = async (m) => {
    s.sockets[0].route.send(JSON.stringify({ type: 'message', id: m.id, conversation_id: ID, message: m }))
    await new Promise((r) => setTimeout(r, 400))
  }
  await page.getByTestId('devreply.composer').fill('Still broken on Safari')
  await page.getByTestId('devreply.send').click()
  await expect(page.locator('.bubble.me', { hasText: 'Still broken on Safari' })).toHaveCount(1)
  await page.waitForTimeout(800)
  await expect(page.locator('.bubble.me', { hasText: 'Still broken on Safari' })).toHaveCount(1)
})

test('live: on home, a reply updates the list and the unread badge', async ({ page }) => {
  const s = await stub(page, conversation())
  await page.goto(`/?key=${PK}&api=${API}`)
  await expect.poll(() => page.evaluate(() => 'DevReply' in window)).toBe(true)
  await page.getByTestId('devreply.launcher').click()
  await expect.poll(() => open(s).length).toBe(1)
  await page.waitForTimeout(300)
  teamSays(s, 'On it, back soon')
  await expect(page.locator('.conv-last').first()).toHaveText('On it, back soon', { timeout: 1_000 })
  await expect(page.locator('#unread')).toHaveText('1')
})

test('live: closing the messenger or hiding the tab closes it normally; back visible, it resumes with after', async ({ page }) => {
  const s = await stub(page, conversation())
  await openChat(page)
  await expect.poll(() => open(s).length).toBe(1)
  await page.waitForTimeout(300)
  const seen = teamSays(s, 'First reply')
  await expect(page.locator('.bubble', { hasText: 'First reply' })).toBeVisible()

  await setVisibility(page, 'hidden')
  await expect.poll(() => s.sockets[0].closed).toBe(1000)
  const missed = teamSays(s, 'Sent while you were away', false)
  await setVisibility(page, 'visible')
  await expect.poll(() => open(s).length).toBe(1)
  expect(new URL(s.sockets[1].url).searchParams.get('after')).toBe(seen.id)
  await expect(page.locator('.bubble', { hasText: 'Sent while you were away' })).toBeVisible({ timeout: 1_000 })
  expect(missed.id > String(seen.id)).toBe(true)

  await page.evaluate(() => (window as unknown as { DevReply: { close(): void } }).DevReply.close())
  await expect.poll(() => s.sockets[1].closed).toBe(1000)
  await page.waitForTimeout(2_500)
  expect(s.sockets.length, 'a normal close never reconnects').toBe(2)
})

test('live: after a drop, polling resumes and it reconnects with after; the backlog fills the gap', async ({ page }) => {
  const s = await stub(page, conversation())
  await openChat(page)
  await expect.poll(() => open(s).length).toBe(1)
  await page.waitForTimeout(300)
  const seen = teamSays(s, 'Before the drop')
  await expect(page.locator('.bubble', { hasText: 'Before the drop' })).toBeVisible()
  // The server goes away (a young connection: counts as a failure, reconnect after 2 s ±20%).
  await s.sockets[0].route.close({ code: 1011, reason: 'restart' })
  teamSays(s, 'Sent during the drop', false)
  await expect.poll(() => s.sockets.length, { timeout: 5_000 }).toBe(2)
  expect(new URL(s.sockets[1].url).searchParams.get('after')).toBe(seen.id)
  await expect(page.locator('.bubble', { hasText: 'Sent during the drop' })).toHaveCount(1)
  teamSays(s, 'And live again')
  await expect(page.locator('.bubble', { hasText: 'And live again' })).toBeVisible({ timeout: 1_000 })
})

test('live: 503 (live off) keeps the 3 s poll, no socket', async ({ page }) => {
  const s = await stub(page, { ...conversation(), liveOff: true })
  await openChat(page)
  await expect.poll(() => s.tickets).toBe(1)
  teamSays(s, 'Polled reply', false)
  await expect(page.locator('.bubble', { hasText: 'Polled reply' })).toBeVisible({ timeout: 4_000 })
  expect(s.sockets.length).toBe(0)
  expect(s.tickets, 'no retries after 503').toBe(1)
})
