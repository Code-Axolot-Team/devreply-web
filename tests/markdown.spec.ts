import { join } from 'node:path'
import { type Page, type Route, expect, test } from '@playwright/test'

// Team replies in Markdown (0.5.0, spec 05): rendered as elements in the team bubble, plain text in
// previews. Against a stubbed API (a copy of v044.spec.ts's stub, reads only), so it runs without a key.
// DEVREPLY_SHOTS: a folder for the screenshots.
const shots = process.env.DEVREPLY_SHOTS ?? ''
const PK = 'pk_stub_0000000000000000'
const API = '/stub'
const ID = '00000000-0000-4000-8000-00000000abcd'

type Json = Record<string, unknown>
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const REPLY = [
  'Thanks for the report! Try this:',
  '',
  '1. Open **Settings**',
  '2. Tap `Export` and pick *CSV*',
  '',
  '- Works on ~~3.2~~ 3.3 and later',
  '- Details: [the export guide](https://devreply.com/docs/export)',
  '',
  '```',
  'defaults write com.fox.notes ExportFormat -string "csv" # then restart the app',
  '```',
  '',
  '> If it still fails, send us the file.',
  '',
  'Not links: [bad](javascript:alert%281%29) and [old](ftp://example.com/f)',
].join('\n')
const FALLBACK = 'Thanks for the report! Try this:\n\n1. Open Settings\n2. Tap Export and pick CSV'

const HE_REPLY = ['תודה! נסו כך:', '', '1. פתחו את **הגדרות**', '2. לחצו על `Export`', '', '> אם זה עדיין לא עובד, שלחו לנו את הקובץ.', '', 'עוד: [המדריך](https://devreply.com/docs)'].join('\n')

/** A little DevReply API, same-origin under /stub/v1/…: one conversation with a Markdown reply. */
async function stub(page: Page, reply: string, fallback: string, user: string) {
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const conversations: Json[] = [{ id: ID, status: 'open', category: 'bug', last_text: fallback, last_author: 'admin', unread: 0, last_message_at: ago(1) }]
  const messages: Json[] = [
    { id: 'm1', author: 'user', created_at: ago(30), blocks: [{ type: 'text', text: user }] },
    // No min_sdk: this 0.4.4 build renders it (the real server says 0.5.0, the next release).
    { id: 'm2', author: 'admin', created_at: ago(1), blocks: [{ type: 'markdown', text: reply, fallback }], persona: { name: 'Dana', title: 'Support', avatar_url: null } },
  ]
  await page.route(`**${API}/v1/**`, async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.slice(API.length)
    const method = req.method()
    if (method === 'POST' && path === '/v1/installs') return json(route, { token: 'tok_1' }, 201)
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
    if (method === 'GET' && path === '/v1/conversations') return json(route, conversations)
    if ((method === 'GET' || method === 'PATCH') && path === '/v1/me') return json(route, { name: 'Ana', email: 'ana@example.com' })
    if (method === 'GET' && path === `/v1/conversations/${ID}/messages`) return json(route, { conversation: conversations[0], messages })
    return route.fulfill({ status: 204 })
  })
}

async function openChat(page: Page, locale = '') {
  await page.goto(`/?key=${PK}&api=${API}${locale ? `&locale=${locale}` : ''}`)
  await expect.poll(() => page.evaluate(() => 'DevReply' in window)).toBe(true)
  await page.getByTestId('devreply.launcher').click()
  await page.locator('.conv').first().click()
  await expect(page.getByTestId('devreply.markdown')).toBeVisible()
  await page.getByTestId('devreply.composer').blur()
  await page.evaluate(() => document.fonts.ready)
}

async function shot(page: Page, name: string) {
  if (!shots) return
  const project = test.info().project.name
  await page.screenshot({ path: join(shots, project === 'chromium' ? name : name.replace('.png', `-${project}.png`)), animations: 'disabled' })
}

const setDark = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { DevReply: { setTheme(t: unknown): void; darkTheme: unknown } }).DevReply
    d.setTheme({ dark: d.darkTheme })
  })

test('a Markdown reply: bold, lists, code, links as elements; unsafe links are text; previews plain @smoke', async ({ page }) => {
  await stub(page, REPLY, FALLBACK, 'Export to CSV does nothing')
  await page.goto(`/?key=${PK}&api=${API}`)
  await expect.poll(() => page.evaluate(() => 'DevReply' in window)).toBe(true)
  await page.getByTestId('devreply.launcher').click()
  // The conversation list shows the plain fallback, never `**`.
  const last = page.locator('.conv-last').first()
  await expect(last).toHaveText(FALLBACK)
  await last.click()

  const md = page.getByTestId('devreply.markdown')
  await expect(md).toBeVisible()
  expect(await md.innerHTML()).not.toContain('**')
  await expect(md.locator('strong', { hasText: 'Settings' })).toBeVisible()
  await expect(md.locator('em', { hasText: 'CSV' })).toBeVisible()
  await expect(md.locator('s', { hasText: '3.2' })).toBeVisible()
  await expect(md.locator('ol')).toHaveCount(1)
  await expect(md.locator('ol > li')).toHaveCount(2)
  await expect(md.locator('ul > li')).toHaveCount(2)
  await expect(md.locator('p code', { hasText: 'Export' }).or(md.locator('li code', { hasText: 'Export' }))).toBeVisible()
  await expect(md.locator('pre code')).toContainText('defaults write com.fox.notes')
  await expect(md.locator('blockquote')).toHaveText('If it still fails, send us the file.')

  // Links: a new tab, no opener; only http(s)/mailto.
  const links = md.locator('a')
  await expect(links).toHaveCount(1)
  await expect(links.first()).toHaveText('the export guide')
  await expect(links.first()).toHaveAttribute('href', 'https://devreply.com/docs/export')
  await expect(links.first()).toHaveAttribute('target', '_blank')
  await expect(links.first()).toHaveAttribute('rel', /noopener/)
  await expect(md).toContainText('Not links: bad and old')
  expect(await md.innerHTML()).not.toContain('javascript:')
  expect(await md.innerHTML()).not.toContain('ftp:')

  // A long code line scrolls inside the block; the bubble keeps its width.
  const pre = md.locator('pre')
  expect(await pre.evaluate((e) => getComputedStyle(e).overflowX)).toBe('auto')
  const bubble = await md.boundingBox()
  const panel = await page.getByTestId('devreply.panel').boundingBox()
  expect(bubble!.x + bubble!.width).toBeLessThanOrEqual(panel!.x + panel!.width)
  // The user's own message stays plain.
  await expect(page.locator('.bubble.me')).toHaveText('Export to CSV does nothing')
  await shot(page, 'web-md-light.png')
})

test('a Markdown reply, dark', async ({ page }) => {
  await stub(page, REPLY, FALLBACK, 'Export to CSV does nothing')
  await page.emulateMedia({ colorScheme: 'dark' })
  await openChat(page)
  await setDark(page)
  await expect(page.locator('.dr')).toHaveAttribute('data-theme', 'dark')
  const code = page.getByTestId('devreply.markdown').locator('pre')
  // Code sits on its own tint, a step from the bubble.
  const [bg, bubble] = await Promise.all([
    code.evaluate((e) => getComputedStyle(e).backgroundColor),
    page.getByTestId('devreply.markdown').evaluate((e) => getComputedStyle(e).backgroundColor),
  ])
  expect(bg).not.toBe(bubble)
  await shot(page, 'web-md-dark.png')
})

test('a Markdown reply, Hebrew: the quote bar and list numbers on the right @smoke', async ({ page }) => {
  await stub(page, HE_REPLY, 'תודה! נסו כך:', 'הייצוא לא עובד מאז העדכון')
  await openChat(page, 'he')
  await expect(page.getByTestId('devreply.panel')).toHaveAttribute('dir', 'rtl')
  const quote = page.getByTestId('devreply.markdown').locator('blockquote')
  const style = await quote.evaluate((e) => {
    const cs = getComputedStyle(e)
    return { right: cs.borderRightWidth, left: cs.borderLeftWidth, pr: cs.paddingRight }
  })
  expect(style).toEqual({ right: '4px', left: '0px', pr: '12px' })
  const ol = page.getByTestId('devreply.markdown').locator('ol')
  expect(await ol.evaluate((e) => getComputedStyle(e).paddingRight)).toBe('24px')
  await expect(page.getByTestId('devreply.markdown').locator('a')).toHaveAttribute('rel', /noopener/)
  await shot(page, 'web-md-he.png')
})
