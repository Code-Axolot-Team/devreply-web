import { type Page, expect, test } from '@playwright/test'

// SDK 0.4 (spec 05): who replied, the app icon, deep links, a refused key isn't hammered. Live, like
// chat.spec.ts. Needs DEVREPLY_TEST_PK (a throwaway web app with an icon), DEVREPLY_TEST_DASH (its
// owner's dashboard token) and DEVREPLY_TEST_SUPPORT (the id of a shared persona with a photo).
const pk = process.env.DEVREPLY_TEST_PK ?? ''
const dash = process.env.DEVREPLY_TEST_DASH ?? ''
const support = process.env.DEVREPLY_TEST_SUPPORT ?? ''
const api = 'https://api.devreply.com'

test.skip(!pk.startsWith('pk_') || !dash || !support, 'DEVREPLY_TEST_PK / _DASH / _SUPPORT not set')

async function teamReply(conversation: string, text: string, persona?: string) {
  const res = await fetch(`${api}/dash/conversations/${conversation}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dash}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text, internal: false, ...(persona ? { persona_id: persona } : {}) }),
  })
  expect(res.status).toBe(201)
}

async function startConversation(page: Page, text: string): Promise<string> {
  await page.goto(`/?key=${pk}`)
  await page.getByTestId('devreply.launcher').click()
  await page.getByTestId('devreply.start.question').click()
  const name = page.getByTestId('devreply.profile.name')
  const composer = page.getByTestId('devreply.composer')
  await expect(name.or(composer)).toBeVisible({ timeout: 15_000 })
  if (await name.isVisible()) {
    await name.fill('Web Tester')
    await page.getByTestId('devreply.profile.save').click()
  }
  const started = page.waitForResponse((r) => r.url().endsWith('/v1/conversations') && r.request().method() === 'POST')
  await composer.fill(text)
  await page.getByTestId('devreply.send').click()
  const body = await (await started).json()
  return body.conversation.id as string
}

test('who replied: once per group, with photos; the app icon in the header', async ({ page }) => {
  const id = await startConversation(page, `Persona test ${Date.now()}`)
  await teamReply(id, 'Hi! Looking into it now.')
  await teamReply(id, 'Found it.')
  await teamReply(id, 'Fixed in 3.3, out tomorrow.', support)
  const labels = page.getByTestId('devreply.persona')
  await expect(labels).toHaveCount(2, { timeout: 15_000 }) // me (2 replies), then Support (1 reply)
  await expect(labels.nth(1)).toContainText('Support')
  await expect(labels.nth(1).locator('img')).toHaveAttribute('src', /\/i\//)
  await expect(page.locator('.bar img.avatar')).toHaveAttribute('src', /\/i\//) // the app icon
  await page.screenshot({ path: 'test-results/v04-thread.png' })
})

test('a DevReply link opens that conversation and leaves a clean address', async ({ page, context }) => {
  const id = await startConversation(page, `Deep link test ${Date.now()}`)
  await teamReply(id, 'Here is your answer from the email button.')
  const fresh = await context.newPage() // same browser: same install
  await fresh.goto(`/?key=${pk}&devreply=${id}`)
  await expect(fresh.getByText('Here is your answer from the email button.')).toBeVisible({ timeout: 15_000 })
  expect(new URL(fresh.url()).searchParams.get('devreply')).toBeNull()
  expect(await fresh.evaluate(() => (window as unknown as { DevReply: { handle(u: string): boolean } }).DevReply.handle('https://x.com/?other=1'))).toBe(false)
})

test('a refused public key is not retried in a loop', async ({ page }) => {
  const attempts: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/installs')) attempts.push(r.url())
  })
  await page.goto(`/?key=pk_${'0'.repeat(24)}`) // a well-formed key the server doesn't know
  await page.getByTestId('devreply.launcher').click()
  await page.getByTestId('devreply.launcher').click() // close: refreshes
  await page.getByTestId('devreply.launcher').click() // open again: refreshes
  await page.waitForTimeout(3_000)
  expect(attempts.length).toBe(1)
})

test('the chat speaks the chosen language, and the app can switch it @smoke', async ({ page }) => {
  await page.goto(`/?key=${pk}&locale=es-MX`)
  await page.getByTestId('devreply.launcher').click()
  await expect(page.getByText('¡Hola! 👋')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Inicia una conversación')).toBeVisible()
  await expect(page.getByText('Suele responder en 3 días hábiles')).toBeVisible()
  await page.getByTestId('devreply.start.bug').click()
  await expect(page.getByText('Algo no funciona')).toBeVisible()
  await expect(page.getByTestId('devreply.composer').or(page.getByTestId('devreply.profile.name'))).toBeVisible()
  await page.screenshot({ path: 'test-results/l10n-es.png' })
  // The app switches it at runtime: the open chat follows.
  await page.evaluate(() => (window as unknown as { DevReply: { setLocale(t: string): void } }).DevReply.setLocale('ja'))
  await expect(page.getByText('うまく動かない')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { DevReply: { language: string } }).DevReply.language)).toBe('ja')
})
