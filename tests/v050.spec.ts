import { join } from 'node:path'
import { type Page, type Route, expect, test } from '@playwright/test'

// SDK 0.5.0 (spec 05 "Button replies", spec 03 "Same device after logout"), against a stubbed API
// (page.route), so it runs without a key. DEVREPLY_SHOTS: a folder for the screenshots.
const shots = process.env.DEVREPLY_SHOTS ?? ''
const PK = 'pk_stub_0000000000000000'
const API = '/stub'
const ID = '00000000-0000-4000-8000-00000000abcd'

type Json = Record<string, unknown>
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

interface Stub {
  installs: Json[]
  patches: Json[]
  conversationGets: number
  sent: Json[]
  /** The status POST …/messages answers with (409: already answered). */
  sendStatus: number
  /** PATCH /v1/me with a user_id answers `restored: true` (and the old conversations come back). */
  restore: boolean
  /** With a 409: the answer that got there first (another device), in the list from then on. */
  answeredElsewhere: Json | null
  conversations: Json[]
  messages: Json[]
}

/** A little DevReply API, same-origin under /stub/v1/…, with the state each test looks at. */
async function stub(page: Page, init: Partial<Stub> = {}): Promise<Stub> {
  const s: Stub = { installs: [], patches: [], conversationGets: 0, sent: [], sendStatus: 201, restore: false, answeredElsewhere: null, conversations: [], messages: [], ...init }
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route(`**${API}/v1/**`, async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.slice(API.length)
    const method = req.method()
    if (method === 'POST' && path === '/v1/installs') {
      s.installs.push(req.postDataJSON() as Json)
      return json(route, { token: `tok_${s.installs.length}` }, 201)
    }
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
        enabled: true,
      })
    if (method === 'GET' && path === '/v1/conversations') {
      s.conversationGets++
      return json(route, s.conversations)
    }
    if (method === 'GET' && path === '/v1/me') return json(route, { name: 'Ana', email: 'ana@example.com' })
    if (method === 'PATCH' && path === '/v1/me') {
      const body = req.postDataJSON() as Json
      s.patches.push(body)
      const restored = s.restore && typeof body.user_id === 'string'
      if (restored) s.conversations = [{ id: ID, status: 'open', category: 'question', last_text: 'My old question', last_author: 'user', unread: 0, last_message_at: ago(600) }]
      return json(route, { name: 'Ana', email: 'ana@example.com', ...(restored ? { restored: true } : {}) })
    }
    if (path === `/v1/conversations/${ID}/messages`) {
      if (method === 'POST') {
        const body = req.postDataJSON() as Json
        s.sent.push(body)
        if (s.sendStatus === 409 && s.answeredElsewhere) s.messages.push(s.answeredElsewhere)
        if (s.sendStatus === 409) return json(route, { error: { code: 'conflict', message: 'already answered' } }, 409)
        // The server echoes the answer on the user message's block.
        const message = { id: `u${s.sent.length}`, author: 'user', created_at: new Date().toISOString(), blocks: [{ type: 'text', text: body.text, ...(body.answer ? { answer: body.answer } : {}) }] }
        s.messages.push(message)
        return json(route, message, 201)
      }
      return json(route, { conversation: s.conversations[0] ?? null, messages: s.messages })
    }
    return route.fulfill({ status: 204 })
  })
  return s
}

const QUESTION = 'Sorry to see you go! **Why did you cancel?**'
const OPTIONS = [
  { id: 'o1', label: 'Too expensive' },
  { id: 'o2', label: 'Missing a feature' },
  { id: 'o3', label: 'Found another app' },
  { id: 'o4', label: 'Something else' },
]
const FALLBACK = 'Sorry to see you go! Why did you cancel?\n\n1. Too expensive\n2. Missing a feature\n3. Found another app\n4. Something else\n\nReply with a number or in your own words.'
const HE = {
  user: 'ביטלתי את המנוי',
  question: 'חבל שאתם עוזבים! **למה ביטלתם?**',
  options: [
    { id: 'o1', label: 'יקר מדי' },
    { id: 'o2', label: 'חסרה לי תכונה' },
    { id: 'o3', label: 'מצאתי אפליקציה אחרת' },
  ],
}

/** One conversation: the user's message, then a question with buttons (no min_sdk unless given). */
function thread(opts: { user?: string; question?: string; options?: { id: string; label: string }[]; minSdk?: string; later?: Json[] } = {}) {
  const question = { type: 'buttons', text: opts.question ?? QUESTION, options: opts.options ?? OPTIONS, fallback: FALLBACK, ...(opts.minSdk ? { min_sdk: opts.minSdk } : {}) }
  return {
    conversations: [{ id: ID, status: 'open', category: 'billing', last_text: 'Sorry to see you go! Why did you cancel?', last_author: 'agent', unread: 0, last_message_at: ago(1) }],
    messages: [
      { id: 'm1', author: 'user', created_at: ago(3), blocks: [{ type: 'text', text: opts.user ?? 'I cancelled my subscription' }] },
      { id: 'q1', author: 'agent', created_at: ago(1), blocks: [question], persona: { name: 'Dana', title: 'Support', avatar_url: null } },
      ...(opts.later ?? []),
    ],
  }
}

async function load(page: Page, locale = '') {
  await page.goto(`/?key=${PK}&api=${API}${locale ? `&locale=${locale}` : ''}`)
  await expect.poll(() => page.evaluate(() => 'DevReply' in window)).toBe(true)
}

async function openChat(page: Page, locale = '') {
  await load(page, locale)
  await page.getByTestId('devreply.launcher').click()
  await page.locator('.conv').first().click()
  await expect(page.getByTestId('devreply.composer')).toBeVisible()
  await page.getByTestId('devreply.composer').blur()
  await page.evaluate(() => document.fonts.ready)
}

async function shot(page: Page, name: string) {
  if (!shots) return
  const project = test.info().project.name
  await page.mouse.move(0, 0) // no hover on the options
  await page.screenshot({ path: join(shots, project === 'chromium' ? name : name.replace('.png', `-${project}.png`)), animations: 'disabled' })
}

const option = (page: Page, id: string) => page.getByTestId(`devreply.buttons.option.${id}`)

async function expectAnswered(page: Page, chosen: string | null) {
  for (const o of OPTIONS) {
    const b = option(page, o.id)
    await expect(b).toBeDisabled()
    await expect(b).toHaveAttribute('aria-pressed', String(o.id === chosen))
    if (o.id === chosen) await expect(b).toHaveClass(/chosen/)
    else await expect(b).not.toHaveClass(/chosen/)
  }
}

// ---- Button replies ----

test('buttons: the question in Markdown, a tap answers with the label and the answer; chosen stays, others quiet; composer stays @smoke', async ({ page }) => {
  const s = await stub(page, thread())
  await load(page)
  await page.getByTestId('devreply.launcher').click()
  // The list shows the question as plain text.
  await expect(page.locator('.conv-last').first()).toHaveText('Sorry to see you go! Why did you cancel?')
  await page.locator('.conv').first().click()
  await page.getByTestId('devreply.composer').blur()

  const question = page.getByTestId('devreply.buttons.question')
  await expect(question.locator('strong')).toHaveText('Why did you cancel?')
  expect(await question.innerHTML()).not.toContain('**')
  const group = page.getByTestId('devreply.buttons')
  await expect(group).toHaveAttribute('role', 'group')
  await expect(group.getByRole('button')).toHaveCount(4)
  for (const o of OPTIONS) {
    await expect(option(page, o.id)).toBeEnabled()
    await expect(option(page, o.id)).toHaveText(o.label)
    await expect(option(page, o.id)).not.toHaveAttribute('aria-pressed', /.*/)
  }
  // Loud: an outline and a hard shadow, like the tiles.
  const look = await option(page, 'o1').evaluate((e) => ({ shadow: getComputedStyle(e).boxShadow, border: getComputedStyle(e).borderTopStyle }))
  expect(look.border).toBe('solid')
  expect(look.shadow).not.toBe('none')
  await page.evaluate(() => document.fonts.ready)
  await shot(page, 'web-buttons-light.png')

  await option(page, 'o2').click()
  await expect.poll(() => s.sent.length).toBe(1)
  expect(s.sent[0]).toEqual({ text: 'Missing a feature', attachment_ids: [], answer: { message_id: 'q1', option_id: 'o2' } })
  await expect(page.locator('.bubble.me', { hasText: 'Missing a feature' })).toBeVisible()
  await expectAnswered(page, 'o2')
  // Highlighted: the primary colour, not the quiet look of the others.
  await expect(option(page, 'o2')).toHaveCSS('background-color', 'rgb(246, 235, 55)')
  await expect(option(page, 'o2')).toHaveCSS('opacity', '1')
  await expect(option(page, 'o1')).toHaveCSS('opacity', '0.45')

  // No second answer; typing still works.
  await option(page, 'o3').click({ force: true })
  await page.getByTestId('devreply.composer').fill('Also, the export was slow')
  await page.getByTestId('devreply.send').click()
  await expect.poll(() => s.sent.length).toBe(2)
  expect(s.sent[1]).toEqual({ text: 'Also, the export was slow', attachment_ids: [] })
  // After the next reload (every 3 s), the server's messages keep it answered.
  await page.waitForTimeout(3_500)
  await expectAnswered(page, 'o2')
  await page.getByTestId('devreply.composer').blur()
  await shot(page, 'web-buttons-light-answered.png')
})

test('buttons: keyboard; Tab reaches the options, a focus ring, Enter answers', async ({ page }) => {
  const s = await stub(page, thread())
  await openChat(page)
  await option(page, 'o1').focus()
  await page.keyboard.press('Tab')
  await expect(option(page, 'o2')).toBeFocused()
  expect(await option(page, 'o2').evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid')
  await page.keyboard.press('Enter')
  await expect.poll(() => s.sent.length).toBe(1)
  expect(s.sent[0].answer).toEqual({ message_id: 'q1', option_id: 'o2' })
  await expectAnswered(page, 'o2')
})

test('buttons: answered before (a later user message carries the answer): shown answered on open', async ({ page }) => {
  await stub(page, thread({ later: [{ id: 'u9', author: 'user', created_at: ago(0), blocks: [{ type: 'text', text: 'Too expensive', answer: { message_id: 'q1', option_id: 'o1' } }] }] }))
  await openChat(page)
  await expectAnswered(page, 'o1')
})

test('buttons: 409 already answered: nothing pending, reloaded, answered as the server says', async ({ page }) => {
  // Answered on another device meanwhile.
  const elsewhere = { id: 'u9', author: 'user', created_at: ago(0), blocks: [{ type: 'text', text: 'Found another app', answer: { message_id: 'q1', option_id: 'o3' } }] }
  const s = await stub(page, { ...thread(), sendStatus: 409, answeredElsewhere: elsewhere })
  await openChat(page)
  await option(page, 'o1').click()
  await expect.poll(() => s.sent.length).toBe(1)
  await expectAnswered(page, 'o3')
  await expect(page.locator('.failed')).toHaveCount(0)
  await expect(page.locator('.bubble.me', { hasText: 'Too expensive' })).toHaveCount(0)
})

test('buttons: 409 and the list has no answer yet: all quiet, none chosen', async ({ page }) => {
  const s = await stub(page, { ...thread(), sendStatus: 409 })
  await openChat(page)
  await option(page, 'o1').click()
  await expect.poll(() => s.sent.length).toBe(1)
  await expectAnswered(page, null)
})

test('buttons needing a newer SDK (min_sdk 0.6.0 on this 0.5.0 build): the fallback, no buttons @smoke', async ({ page }) => {
  await stub(page, thread({ minSdk: '0.6.0' }))
  await openChat(page)
  await expect(page.getByTestId('devreply.buttons')).toHaveCount(0)
  const bubble = page.locator('.bubble.team.muted')
  await expect(bubble).toContainText('1. Too expensive')
  await expect(bubble).toContainText('Reply with a number or in your own words.')
})

const setDark = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { DevReply: { setTheme(t: unknown): void; darkTheme: unknown } }).DevReply
    d.setTheme({ dark: d.darkTheme })
  })

test('buttons, dark: open and answered', async ({ page }) => {
  await stub(page, thread())
  await page.emulateMedia({ colorScheme: 'dark' })
  await openChat(page)
  await setDark(page)
  await expect(page.locator('.dr')).toHaveAttribute('data-theme', 'dark')
  await shot(page, 'web-buttons-dark.png')
  await option(page, 'o4').click()
  await expectAnswered(page, 'o4')
  // Chosen: the dark primary with its contrasting text.
  await expect(option(page, 'o4')).toHaveCSS('background-color', 'rgb(43, 80, 224)')
  await expect(option(page, 'o4')).toHaveCSS('color', 'rgb(255, 255, 255)')
  await page.getByTestId('devreply.composer').blur()
  await shot(page, 'web-buttons-dark-answered.png')
})

test('buttons, Hebrew: options on the right, text from the start side @smoke', async ({ page }) => {
  const s = await stub(page, thread({ user: HE.user, question: HE.question, options: HE.options }))
  await openChat(page, 'he')
  await expect(page.getByTestId('devreply.panel')).toHaveAttribute('dir', 'rtl')
  const panel = (await page.getByTestId('devreply.panel').boundingBox())!
  const b = (await option(page, 'o1').boundingBox())!
  // The team side is the right in RTL: the options hug it.
  expect(panel.x + panel.width - (b.x + b.width)).toBeLessThan(90)
  expect(await option(page, 'o1').evaluate((e) => getComputedStyle(e).textAlign)).toBe('start')
  await shot(page, 'web-buttons-he.png')
  await option(page, 'o2').click()
  await expect.poll(() => s.sent.length).toBe(1)
  expect(s.sent[0]).toEqual({ text: 'חסרה לי תכונה', attachment_ids: [], answer: { message_id: 'q1', option_id: 'o2' } })
  await expect(option(page, 'o2')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('devreply.composer').blur()
  await shot(page, 'web-buttons-he-answered.png')
})

// ---- Same device after logout: the device key ----

const dr = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([fn, args]) => (window as never as Record<string, Record<string, (...a: unknown[]) => unknown>>).DevReply[fn as string](...(args as unknown[])), [fn, args] as const)
const deviceKeyInStorage = (page: Page) =>
  page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('devreply:device:'))
    return k ? { key: k, value: localStorage.getItem(k) } : null
  })

test('device key: 256 random bits, created once, sent at registration, kept through logout @smoke', async ({ page }) => {
  const s = await stub(page)
  await load(page)
  await expect.poll(() => s.installs.length).toBe(1)
  const key = s.installs[0].device_key as string
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 bytes, base64url without padding
  expect(await deviceKeyInStorage(page)).toEqual({ key: `devreply:device:${PK}`, value: key })

  await dr(page, 'login', 'ana-1')
  await dr(page, 'logout')
  // A new, empty install, with the same device key.
  await expect.poll(() => s.installs.length).toBe(2)
  expect(s.installs[1].device_key).toBe(key)
  expect((await deviceKeyInStorage(page))?.value).toBe(key)
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('devreply:user:')))).toBe(false)

  // The next page load keeps it too; another browser (cleared storage) gets a new one.
  await load(page)
  expect((await deviceKeyInStorage(page))?.value).toBe(key)
  await page.evaluate(() => localStorage.clear())
  await load(page)
  await expect.poll(() => s.installs.length).toBe(3)
  expect(s.installs[2].device_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(s.installs[2].device_key).not.toBe(key)
})

test('device key: no localStorage, still one key for the page', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('blocked') } })
  })
  const s = await stub(page)
  await load(page)
  await expect.poll(() => s.installs.length).toBe(1)
  await dr(page, 'login', 'ana-1')
  await expect.poll(() => s.patches.length).toBe(1)
  await dr(page, 'logout')
  await expect.poll(() => s.installs.length).toBeGreaterThanOrEqual(2)
  expect(s.installs[0].device_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(s.installs.at(-1)!.device_key).toBe(s.installs[0].device_key)
})

test('login answered restored: true reloads the list: the old conversations are back @smoke', async ({ page }) => {
  const s = await stub(page, { restore: true })
  await load(page)
  await expect.poll(() => s.conversationGets).toBe(1)
  await dr(page, 'login', 'ana-1')
  await expect.poll(() => s.patches.length).toBe(1)
  expect(s.patches[0].user_id).toBe('ana-1')
  await expect.poll(() => s.conversationGets).toBe(2)
  await page.getByTestId('devreply.launcher').click()
  await expect(page.locator('.conv-last').first()).toHaveText('My old question')
})

test('login without restored: no extra reload', async ({ page }) => {
  const s = await stub(page)
  await load(page)
  await expect.poll(() => s.conversationGets).toBe(1)
  await dr(page, 'login', 'ana-1')
  await expect.poll(() => s.patches.length).toBe(1)
  await page.waitForTimeout(500)
  expect(s.conversationGets).toBe(1)
})
