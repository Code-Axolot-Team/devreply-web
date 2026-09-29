import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Page, type Route, expect, test } from '@playwright/test'

// SDK 0.4.4 (spec 05): open with a prefilled message and context, the remote on/off switch, events,
// a deletion that never gives up, the dark theme. Against a stubbed API (page.route), so it runs
// without a key. DEVREPLY_SHOTS: a folder for the screenshots. DEVREPLY_BASELINE_DIST: the dist/ of the
// previous release, to prove light mode is pixel-identical to it.
const shots = process.env.DEVREPLY_SHOTS ?? ''
const baseline = process.env.DEVREPLY_BASELINE_DIST ?? ''
const PK = 'pk_stub_0000000000000000'
const API = '/stub'

type Json = Record<string, unknown>
interface Stub {
  enabled: boolean
  deleteStatus: number
  installs: number
  started: Json[]
  sent: Json[]
  deletes: string[]
  logouts: string[]
  conversations: Json[]
  messages: Record<string, Json[]>
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

/** A little DevReply API, same-origin under /stub/v1/…, with the state each test looks at. */
async function stub(page: Page, init: Partial<Stub> = {}): Promise<Stub> {
  const s: Stub = { enabled: true, deleteStatus: 204, installs: 0, started: [], sent: [], deletes: [], logouts: [], conversations: [], messages: {}, ...init }
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**${API}/v1/**`, async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.slice(API.length)
    const method = req.method()
    const auth = req.headers().authorization ?? ''
    if (method === 'POST' && path === '/v1/installs') return json(route, { token: `tok_${++s.installs}` }, 201)
    if (method === 'GET' && path === '/v1/messenger/config')
      return json(route, {
        app_name: 'Fox Notes',
        team_name: 'Fox Notes',
        greeting: 'Hi there 👋',
        intro: "Ask us anything, or tell us what's broken.",
        reply_time: 'Usually replies within 3 working days',
        reply_within: '3 working days',
        reply_within_key: '3_working_days',
        localize: ['greeting', 'intro', 'start_buttons', 'reply_time', 'reply_within'],
        start_buttons: ['bug', 'billing', 'idea', 'question'].map((c) => ({ category: c, title: c })),
        team: [],
        enabled: s.enabled,
      })
    if (method === 'GET' && path === '/v1/conversations') return json(route, s.conversations)
    if ((method === 'GET' || method === 'PATCH') && path === '/v1/me') return json(route, { name: 'Ana', email: 'ana@example.com' })
    if (method === 'DELETE' && path === '/v1/me') {
      s.deletes.push(auth)
      return route.fulfill({ status: s.deleteStatus, body: s.deleteStatus === 204 ? '' : '{}' })
    }
    if (method === 'POST' && path === '/v1/logout') {
      s.logouts.push(auth)
      return route.fulfill({ status: 204 })
    }
    if (method === 'POST' && path === '/v1/conversations') {
      const body = req.postDataJSON() as Json
      s.started.push(body)
      const id = `00000000-0000-4000-8000-${String(s.started.length).padStart(12, '0')}`
      const at = new Date().toISOString()
      const conversation = { id, status: 'open', category: body.category, last_text: body.text, last_author: 'user', unread: 0, last_message_at: at }
      const message = { id: `m-${id}`, author: 'user', created_at: at, blocks: [{ type: 'text', text: body.text }] }
      s.conversations.unshift(conversation)
      s.messages[id] = [message]
      return json(route, { conversation, message }, 201)
    }
    const thread = /^\/v1\/conversations\/([^/]+)\/messages$/.exec(path)
    if (thread) {
      const id = thread[1]
      if (method === 'POST') {
        const body = req.postDataJSON() as Json
        s.sent.push({ ...body, conversation: id })
        const message = { id: `m-${Date.now()}-${s.sent.length}`, author: 'user', created_at: new Date().toISOString(), blocks: [{ type: 'text', text: body.text }] }
        ;(s.messages[id] ??= []).push(message)
        return json(route, message, 201)
      }
      return json(route, { conversation: s.conversations.find((c) => c.id === id) ?? null, messages: s.messages[id] ?? [] })
    }
    return route.fulfill({ status: 204 })
  })
  return s
}

async function load(page: Page, extra = '') {
  await page.goto(`/?key=${PK}&api=${API}${extra}`)
  await expect.poll(() => page.evaluate(() => 'DevReply' in window)).toBe(true)
}

/** Records every DevReply event in window.events, in order. */
async function recordEvents(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { events: unknown[]; DevReply: { on(e: string, fn: (p?: unknown) => void): () => void } }
    w.events = []
    for (const e of ['open', 'close', 'conversationStarted', 'messageSent']) w.DevReply.on(e, (p) => w.events.push(p ? [e, p] : [e]))
  })
}
const events = (page: Page) => page.evaluate(() => (window as unknown as { events: unknown[] }).events)

const dr = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([fn, args]) => (window as never as Record<string, Record<string, (...a: unknown[]) => T>>).DevReply[fn as string](...(args as unknown[])), [fn, args] as const)

async function shot(page: Page, name: string) {
  if (!shots) return
  await page.screenshot({ path: join(shots, name), animations: 'disabled' })
}

const colour = (page: Page, selector: string, prop: string) =>
  page.locator(selector).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)

test('open with a message and attributes: prefilled, not sent; context on the first new conversation only; events in order @smoke', async ({ page }) => {
  const s = await stub(page)
  await load(page)
  await recordEvents(page)

  const opened = await dr<boolean>(page, 'open', {
    category: 'bug',
    message: 'The export button does nothing',
    attributes: { plan: 'pro', seats: 3, trial: false, 'bad key!': 'x', gone: null },
  })
  expect(opened).toBe(true)
  const composer = page.getByTestId('devreply.composer')
  await expect(composer).toHaveValue('The export button does nothing')
  await shot(page, 'web-prefilled-composer.png')
  await page.waitForTimeout(500)
  expect(s.started).toHaveLength(0) // never sent by itself

  await composer.press('End')
  await composer.pressSequentially(' on Safari')
  await page.getByTestId('devreply.send').click()
  await expect(page.getByText('The export button does nothing on Safari', { exact: true })).toBeVisible()
  expect(s.started).toHaveLength(1)
  expect(s.started[0]).toMatchObject({ category: 'bug', text: 'The export button does nothing on Safari', context: { plan: 'pro', seats: 3, trial: false } })
  expect(Object.keys(s.started[0].context as Json)).toEqual(['plan', 'seats', 'trial'])

  await composer.fill('Second one')
  await page.getByTestId('devreply.send').click()
  await expect(page.getByText('Second one', { exact: true })).toBeVisible()

  // Another new conversation in the same presentation: no draft, no context.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByTestId('devreply.start.idea').click()
  await expect(composer).toHaveValue('')
  await composer.fill('An idea')
  await page.getByTestId('devreply.send').click()
  await expect.poll(() => s.started.length).toBe(2)
  expect(s.started[1].context).toBeUndefined()
  await expect.poll(async () => (await events(page)).length).toBe(6)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('devreply.panel')).toBeHidden()

  const first = (s.conversations[1] as Json).id
  const second = (s.conversations[0] as Json).id
  expect(await events(page)).toEqual([
    ['open'],
    ['conversationStarted', { conversationId: first, category: 'bug' }],
    ['messageSent', { conversationId: first }],
    ['messageSent', { conversationId: first }],
    ['conversationStarted', { conversationId: second, category: 'idea' }],
    ['messageSent', { conversationId: second }],
    ['close'],
  ])

  // Without a category: home first, the draft waits for the start button. The old shapes still work.
  expect(await dr<boolean>(page, 'present', { message: 'Hello from the help page' })).toBe(true)
  await expect(page.getByTestId('devreply.start.question')).toBeVisible()
  await page.getByTestId('devreply.start.question').click()
  await expect(composer).toHaveValue('Hello from the help page')
  await page.keyboard.press('Escape')
  expect(await dr<boolean>(page, 'open', 'billing', { message: 'Refund please' })).toBe(true)
  await expect(composer).toHaveValue('Refund please')
  await page.keyboard.press('Escape')
  expect(await dr<boolean>(page, 'open', 'bug')).toBe(true)
  await expect(composer).toHaveValue('') // closing dropped the last presentation's draft
  // A listener's unsubscribe stops it.
  await page.evaluate(() => {
    const w = window as unknown as { hits: number; DevReply: { on(e: string, fn: () => void): () => void } }
    w.hits = 0
    const stop = w.DevReply.on('close', () => w.hits++)
    stop()
  })
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => (window as unknown as { hits: number }).hits)).toBe(0)
})

test('the team switches the chat off: open returns false, the launcher hides, an open chat closes @smoke', async ({ page }) => {
  const s = await stub(page)
  await load(page)
  await recordEvents(page)
  expect(await dr<boolean>(page, 'open')).toBe(true)
  await expect(page.getByTestId('devreply.panel')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { DevReply: { isAvailable: boolean } }).DevReply.isAvailable)).toBe(true)

  s.enabled = false
  await dr(page, 'refresh')
  await expect(page.getByTestId('devreply.panel')).toBeHidden()
  await expect(page.getByTestId('devreply.launcher')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { DevReply: { isAvailable: boolean } }).DevReply.isAvailable)).toBe(false)
  expect(await dr<boolean>(page, 'open', 'bug')).toBe(false)
  expect(await dr<boolean>(page, 'present', { category: 'bug', message: 'x' })).toBe(false)
  await expect(page.getByTestId('devreply.panel')).toHaveCount(0)
  expect(await events(page)).toEqual([['open'], ['close']])

  // The next page load knows at once, from the cached config; a DevReply link doesn't open it either.
  await load(page, '&devreply=00000000-0000-4000-8000-000000000001')
  expect(await page.evaluate(() => (window as unknown as { DevReply: { isAvailable: boolean } }).DevReply.isAvailable)).toBe(false)
  await expect(page.getByTestId('devreply.panel')).toHaveCount(0)
  await expect(page.getByTestId('devreply.launcher')).toHaveCount(0)

  // Switched back on: available again after the next config.
  s.enabled = true
  await dr(page, 'refresh')
  await expect(page.getByTestId('devreply.launcher')).toBeVisible()
  expect(await dr<boolean>(page, 'open')).toBe(true)
})

test('deleteUser that never gives up: forgets at once, retries with the old token until done', async ({ page }) => {
  const s = await stub(page, { deleteStatus: 503 })
  await load(page)
  await dr(page, 'login', 'user-42')
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('devreply:token:')))).toBeTruthy()
  const oldToken = await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('devreply:token:'))!))
  expect(oldToken).toBe('tok_1')

  expect(await dr<boolean>(page, 'deleteUser')).toBe(false) // queued
  const pending = () =>
    page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('devreply:pending-deletions:'))
      return k ? JSON.parse(localStorage.getItem(k)!) : []
    })
  expect(await pending()).toEqual(['tok_1'])
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('devreply:user:')))).toBe(false)
  expect(s.logouts).toHaveLength(0) // forgotten on the device only, no POST /v1/logout
  // The browser goes on with a new install.
  await expect.poll(() => s.installs).toBe(2)

  // Still failing (429, 500): kept. Back in the tab: retried.
  s.deleteStatus = 429
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => s.deletes.length).toBe(2)
  expect(await pending()).toEqual(['tok_1'])

  // The next page load: done (404 = already gone counts too), with the OLD token, never the new one.
  s.deleteStatus = 404
  await load(page)
  await expect.poll(() => s.deletes.length).toBe(3)
  expect(s.deletes).toEqual(['Bearer tok_1', 'Bearer tok_1', 'Bearer tok_1'])
  await expect.poll(pending).toEqual([])

  // Reachable: deleted now.
  s.deleteStatus = 204
  await dr(page, 'login', 'user-43')
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('devreply:token:')))).toBeTruthy()
  expect(await dr<boolean>(page, 'deleteUser')).toBe(true)
  expect(await pending()).toEqual([])
})

const setTheme = (page: Page, themes: unknown) =>
  page.evaluate((themes) => (window as unknown as { DevReply: { setTheme(t: unknown): void } }).DevReply.setTheme(themes), themes)
const setDark = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { DevReply: { setTheme(t: unknown): void; darkTheme: unknown } }).DevReply
    d.setTheme({ dark: d.darkTheme })
  })
/** The messenger's internal colours, resolved (`var(--dr-x)` followed). */
const VARS = ['bg', 'surface', 'ink', 'muted', 'outline', 'shadow', 'ow', 'primary', 'on-primary', 'header', 'on-header', 'accent', 'on-accent',
  'card', 'on-card', 'user', 'user-text', 'team', 'team-text', 'notice', 'error', 'lemon', 'on-lemon', 'badge', 'tag-bg', 'tag-text', 'focus']
async function tokens(page: Page): Promise<Record<string, string>> {
  const raw = await page.locator('.dr').evaluate((e, names) => {
    const cs = getComputedStyle(e)
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--dr-${n}`).trim()]))
  }, VARS)
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.toUpperCase().replace(/^#FFF$/, '#FFFFFF').replace(/^#111$/, '#111111')]))
}
/** Light: exactly 0.4.3. */
const LIGHT = {
  bg: '#FFFDF2', surface: '#FFFFFF', ink: '#111111', muted: '#4A4740', outline: '#111111', shadow: '#111111', ow: '1', primary: '#F6EB37',
  'on-primary': '#111111', header: '#F6EB37', 'on-header': '#111111', accent: '#FF5FA2', 'on-accent': '#111111', card: '#F6EB37',
  'on-card': '#111111', user: '#2B50E0', 'user-text': '#FFFFFF', team: '#FFFFFF', 'team-text': '#111111', notice: '#FFFFFF', error: '#B32619',
  lemon: '#F6EB37', 'on-lemon': '#111111', badge: '#FF5FA2', 'tag-bg': '#111111', 'tag-text': '#F6EB37', focus: '#2B50E0',
}
/** Dark, "Deep blue": the preset's six colours and what's derived from them. */
const DARK = {
  bg: '#0E1320', ink: '#EEF1F8', primary: '#2B50E0', accent: '#FF5FA2', user: '#3F6BFF', 'user-text': '#FFFFFF',
  surface: '#181E30', card: '#181E30', notice: '#181E30', team: '#181E30', // 8 % from the page toward mix(text, primary, 50 %)
  'team-text': '#EEF1F8', 'on-card': '#EEF1F8', muted: '#A0A3AC', // 35 % from the text toward the page
  outline: '#EEF1F8', ow: '0.5', shadow: '#06080D', // 60 % from the page toward black
  header: '#2B50E0', 'on-header': '#FFFFFF', 'on-primary': '#FFFFFF', 'on-accent': '#111111', error: '#FF8A7E',
  lemon: '#F6EB37', 'on-lemon': '#111111', badge: '#F6EB37', 'tag-bg': '#F6EB37', 'tag-text': '#111111', focus: '#3F6BFF',
}
const CUSTOM = { primary: '#0A84FF', accent: '#FF9F0A' }

test('six public colours; everything else derived as the spec says; other keys ignored @smoke', async ({ page }) => {
  await stub(page)
  await load(page)
  await page.getByTestId('devreply.launcher').click()
  expect(await tokens(page)).toEqual(LIGHT)

  // Light: header and cards follow primary, outlines, shadows and text on primary follow ink; other keys are ignored.
  await setTheme(page, { light: { primary: '#0A84FF', ink: '#222222', surface: '#EEEEEE', header: '#123456', outlineWidth: 2, onPrimary: '#FF0000' } })
  expect(await tokens(page)).toEqual({
    ...LIGHT, primary: '#0A84FF', header: '#0A84FF', card: '#0A84FF', ink: '#222222', outline: '#222222', shadow: '#222222',
    'on-primary': '#222222', 'on-header': '#222222', 'on-accent': '#222222', 'on-card': '#222222', 'team-text': '#222222',
    'on-lemon': '#222222', 'tag-bg': '#222222',
  })
  await setTheme(page, { light: null })
  expect(await tokens(page)).toEqual(LIGHT)

  // The dark preset, only when the browser prefers dark.
  await setDark(page)
  expect(await tokens(page)).toEqual(LIGHT)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('.dr')).toHaveAttribute('data-theme', 'dark')
  expect(await tokens(page)).toEqual(DARK)
  // A site's dark colours: the rest follows them (a light primary gets dark text).
  await setTheme(page, { dark: { background: '#000000', ink: '#FFFFFF', primary: '#F6EB37', surface: '#FF0000' } })
  expect(await tokens(page)).toMatchObject({
    bg: '#000000', surface: '#14140C', muted: '#A6A6A6', shadow: '#000000', outline: '#FFFFFF', header: '#F6EB37',
    'on-header': '#111111', accent: '#FF5FA2', user: '#3F6BFF',
  })
  // Something that could break out of the style attribute is ignored.
  await setTheme(page, { dark: { primary: 'red;display:none' } })
  expect(await tokens(page)).toEqual(DARK)
})

test('dark theme: only when given, then whenever the browser prefers dark @smoke', async ({ page }) => {
  const s = await stub(page)
  const id = '00000000-0000-4000-8000-00000000abcd'
  s.conversations = [{ id, status: 'open', category: 'bug', last_text: 'Found it: fixed in 3.3.', last_author: 'admin', unread: 0, last_message_at: ago(60 * 26) }]
  s.messages[id] = [
    { id: 'a', author: 'user', created_at: ago(60 * 27), blocks: [{ type: 'text', text: 'Export to PDF crashes the app' }] },
    { id: 'b', author: 'admin', created_at: ago(60 * 26), blocks: [{ type: 'text', text: 'Found it: fixed in 3.3.' }], persona: { name: 'Sergei', title: 'Founder' } },
  ]
  await page.emulateMedia({ colorScheme: 'dark' })
  await load(page)
  await page.getByTestId('devreply.launcher').click()
  // No dark theme given: light, even though the browser prefers dark; the light icons.
  await expect(page.locator('.dr')).toHaveAttribute('data-theme', 'light')
  expect(await colour(page, '.panel', 'background-color')).toBe('rgb(255, 253, 242)')
  expect(await page.locator('.tile .cat').first().innerHTML()).toContain('#111111')

  await setDark(page)
  await expect(page.locator('.dr')).toHaveAttribute('data-theme', 'dark')
  expect(await colour(page, '.panel', 'background-color')).toBe('rgb(14, 19, 32)')
  expect(await colour(page, '.panel', 'border-top-color')).toBe('rgb(238, 241, 248)') // thin light outlines
  const width = parseFloat(await colour(page, '.tile', 'border-top-width')) // 3px × 0.5, snapped to device pixels
  expect(width).toBeGreaterThanOrEqual(1)
  expect(width).toBeLessThanOrEqual(1.5)
  expect(await colour(page, '.tile', 'background-color')).toBe('rgb(24, 30, 48)')
  expect(await colour(page, '.tile', 'color')).toBe('rgb(238, 241, 248)')
  await expect.poll(() => colour(page, '.tile', 'box-shadow')).toBe('rgb(6, 8, 13) 5px 5px 0px 0px') // after the tile's transition
  expect(await page.locator('.tile .cat').first().innerHTML()).toContain('#EEF1F8') // the dark artwork
  expect(await colour(page, '.home-head', 'background-color')).toBe('rgb(43, 80, 224)')
  expect(await colour(page, '.greeting', 'color')).toBe('rgb(255, 255, 255)')
  expect(await colour(page, '.kicker.inv', 'background-color')).toBe('rgb(246, 235, 55)') // lemon team tag
  expect(await colour(page, '.kicker.inv', 'color')).toBe('rgb(17, 17, 17)')
  expect(await colour(page, '.conv-top .when', 'color')).toBe('rgb(160, 163, 172)')
  expect(await colour(page, '.launcher', 'background-color')).toBe('rgb(246, 235, 55)')
  await page.getByText('Found it: fixed in 3.3.').click()
  await expect(page.locator('.bubble.team')).toBeVisible()
  expect(await colour(page, '.bubble.team', 'background-color')).toBe('rgb(24, 30, 48)')
  expect(await colour(page, '.bubble.team', 'color')).toBe('rgb(238, 241, 248)')
  expect(await colour(page, '.bubble.me', 'background-color')).toBe('rgb(63, 107, 255)')
  expect(await colour(page, '.composer', 'background-color')).toBe('rgb(24, 30, 48)')
  expect(await colour(page, '.send', 'color')).toBe('rgb(17, 17, 17)')
  expect(await colour(page, '.bar', 'background-color')).toBe('rgb(43, 80, 224)')
  expect(await colour(page, '.bar-name', 'color')).toBe('rgb(255, 255, 255)')
  // The attach menu.
  await page.getByTestId('devreply.attach').click()
  expect(await colour(page, '.menu', 'background-color')).toBe('rgb(24, 30, 48)')
  expect(await colour(page, '.menu button', 'color')).toBe('rgb(238, 241, 248)')

  // The browser switches back to light: so does the chat, live.
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('.dr')).toHaveAttribute('data-theme', 'light')
  expect(await colour(page, '.bubble.team', 'background-color')).toBe('rgb(255, 255, 255)')
})

/** A thread with a photo and an unread reply (the launcher's badge). */
const PHOTO = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#FF5FA2"/><rect x="40" y="40" width="120" height="80" fill="#2B50E0"/></svg>')}`
async function overlays(page: Page, name: string): Promise<Record<string, string>> {
  await page.clock.setFixedTime(new Date('2026-09-29T12:00:00Z'))
  const s = await stub(page)
  const id = '00000000-0000-4000-8000-00000000abcd'
  s.conversations = [{ id, status: 'open', category: 'bug', last_text: 'Here it is', last_author: 'admin', unread: 1, last_message_at: '2026-09-28T10:05:00Z' }]
  s.messages[id] = [
    { id: 'a', author: 'user', created_at: '2026-09-28T10:00:00Z', blocks: [{ type: 'text', text: 'Export to PDF crashes the app' }] },
    { id: 'b', author: 'admin', created_at: '2026-09-28T10:05:00Z', blocks: [{ type: 'text', text: 'Here it is' }, { type: 'image', url: PHOTO, width: 300, height: 200 }] },
  ]
  await load(page)
  await expect(page.locator('.launcher .badge')).toHaveText('1', { timeout: 15_000 })
  await page.evaluate(() => document.fonts.ready)
  const seen: Record<string, string> = {
    launcher: await colour(page, '.launcher', 'background-color'),
    badge: await colour(page, '.badge', 'background-color'),
    badgeText: await colour(page, '.badge', 'color'),
  }
  await page.locator('.launcher').screenshot({ path: shots ? join(shots, `${name}-launcher-badge.png`) : undefined, animations: 'disabled' })
  await page.getByTestId('devreply.launcher').click()
  await page.locator('.photo').click()
  await expect(page.locator('.viewer')).toBeVisible()
  seen.overlay = await colour(page, '.viewer', 'background-color')
  seen.viewerButton = await colour(page, '.viewer .icon-btn', 'background-color')
  await shot(page, `${name}-image-viewer.png`)
  await page.locator('.viewer .icon-btn').click()
  await page.getByTestId('devreply.attach').click()
  await shot(page, `${name}-attach-menu.png`)
  seen.menu = await colour(page, '.menu', 'background-color')
  await page.getByTestId('devreply.attach').click() // closes the menu
  // The focus ring, from the keyboard.
  await page.getByTestId('devreply.composer').focus()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByTestId('devreply.attach')).toBeFocused()
  await shot(page, `${name}-focus-ring.png`)
  seen.focus = await colour(page, '[data-testid="devreply.attach"]', 'outline-color')
  return seen
}

test('overlays follow the dark look: launcher and badge, image viewer, attach menu, focus ring', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => addEventListener('devreply:ready', () => {
    const d = (window as unknown as { DevReply: { setTheme(t: unknown): void; darkTheme: unknown } }).DevReply
    d.setTheme({ dark: d.darkTheme })
  }))
  expect(await overlays(page, 'web-dark')).toEqual({
    launcher: 'rgb(246, 235, 55)',
    badge: 'rgb(246, 235, 55)',
    badgeText: 'rgb(17, 17, 17)',
    overlay: 'rgba(17, 17, 17, 0.94)',
    viewerButton: 'rgb(246, 235, 55)',
    menu: 'rgb(24, 30, 48)',
    focus: 'rgb(63, 107, 255)',
  })
})

test('overlays with custom light colours: as 0.4.3', async ({ page }) => {
  await page.addInitScript((theme) => addEventListener('devreply:ready', () => {
    ;(window as unknown as { DevReply: { setTheme(t: unknown): void } }).DevReply.setTheme({ light: theme })
  }), { ...CUSTOM, userBubble: '#8E44AD' })
  expect(await overlays(page, 'web-custom')).toEqual({
    launcher: 'rgb(246, 235, 55)',
    badge: 'rgb(255, 95, 162)',
    badgeText: 'rgb(17, 17, 17)',
    overlay: 'rgba(17, 17, 17, 0.94)',
    viewerButton: 'rgb(246, 235, 55)',
    menu: 'rgb(255, 255, 255)',
    focus: 'rgb(142, 68, 173)',
  })
})

test('screenshots: home and chat, light, dark and custom colours', async ({ page }) => {
  test.skip(!shots, 'DEVREPLY_SHOTS not set')
  await screens(page, '/dist/devreply.js', 'web')
  await page.emulateMedia({ colorScheme: 'dark' })
  await setDark(page)
  await shot(page, 'web-dark-chat.png')
  await page.getByRole('button', { name: 'Back' }).click()
  await shot(page, 'web-dark-home.png')
  await page.emulateMedia({ colorScheme: 'light' })
  await setTheme(page, { light: CUSTOM })
  await shot(page, 'web-custom-home.png')
  await page.getByText('Found it: fixed in 3.3.').click()
  await expect(page.locator('.bubble.team')).toBeVisible()
  await shot(page, 'web-custom-chat.png')
})

/** Home and a chat with a reply, on a fixed clock; returns the two screenshots. */
async function screens(page: Page, src: string, prefix: string): Promise<Buffer[]> {
  await page.clock.setFixedTime(new Date('2026-09-29T12:00:00Z'))
  const s = await stub(page)
  const id = '00000000-0000-4000-8000-00000000abcd'
  s.conversations = [{ id, status: 'open', category: 'bug', last_text: 'Found it: fixed in 3.3.', last_author: 'admin', unread: 0, last_message_at: '2026-09-28T10:05:00Z' }]
  s.messages[id] = [
    { id: 'a', author: 'user', created_at: '2026-09-28T10:00:00Z', blocks: [{ type: 'text', text: 'Export to PDF crashes the app' }] },
    { id: 'b', author: 'admin', created_at: '2026-09-28T10:05:00Z', blocks: [{ type: 'text', text: 'Found it: fixed in 3.3.' }] },
  ]
  await page.goto(`/?key=${PK}&api=${API}&src=${encodeURIComponent(src)}`)
  await page.getByTestId('devreply.launcher').click()
  await expect(page.getByText('Found it: fixed in 3.3.')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const home = await page.screenshot({ animations: 'disabled', ...(shots ? { path: join(shots, `${prefix}-light-home.png`) } : {}) })
  await page.getByText('Found it: fixed in 3.3.').click()
  await expect(page.locator('.bubble.team')).toBeVisible()
  await page.getByTestId('devreply.composer').blur()
  const chat = await page.screenshot({ animations: 'disabled', ...(shots ? { path: join(shots, `${prefix}-light-chat.png`) } : {}) })
  return [home, chat]
}

test('light mode is pixel-identical to the previous release', async ({ page }) => {
  test.skip(!baseline, 'DEVREPLY_BASELINE_DIST not set')
  await page.route('**/baseline/**', (route) => {
    const file = new URL(route.request().url()).pathname.replace(/^\/baseline\//, '')
    return route.fulfill({ body: readFileSync(join(baseline, file)), contentType: file.endsWith('.js') ? 'text/javascript' : 'font/woff2' })
  })
  const before = await screens(page, '/baseline/devreply.js', 'baseline')
  const after = await screens(page, '/dist/devreply.js', 'web')
  expect(after[0].equals(before[0])).toBe(true)
  expect(after[1].equals(before[1])).toBe(true)
})
