import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'

// Live: the built SDK on a test page, against the real API. Needs DEVREPLY_TEST_PK (a throwaway app's
// web key) and, for the unread test, a script that answers "Bubble test <nonce>" with
// "Founder reply <nonce>" from the dashboard API (DEVREPLY_TEST_NONCE).
const pk = process.env.DEVREPLY_TEST_PK ?? ''
const nonce = process.env.DEVREPLY_TEST_NONCE ?? String(Date.now() % 100000)

test.skip(!pk.startsWith('pk_'), 'DEVREPLY_TEST_PK not set')

async function load(page: Page, launcher?: string) {
  await page.goto(`/?key=${pk}${launcher ? `&launcher=${launcher}` : ''}`)
}

async function startNew(page: Page, category: string, text: string) {
  await page.getByTestId('devreply.launcher').click()
  await page.getByTestId(`devreply.start.${category}`).click()
  const name = page.getByTestId('devreply.profile.name')
  const composer = page.getByTestId('devreply.composer')
  await expect(name.or(composer)).toBeVisible({ timeout: 15_000 })
  if (await name.isVisible()) {
    await name.fill('Web Tester')
    await page.getByTestId('devreply.profile.save').click()
  }
  await composer.fill(text)
  await page.getByTestId('devreply.send').click()
  await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 })
}

test('first message: notice with the reply time, optional email, Enter sends @smoke', async ({ page }, info) => {
  await load(page)
  const launcher = page.getByTestId('devreply.launcher')
  await expect(launcher).toBeVisible()
  await expect(launcher).toHaveAccessibleName(/Chat with/)
  await launcher.click()
  await expect(page.getByTestId('devreply.panel')).toBeVisible()
  await expect(page.getByText("Ask us anything, or tell us what's broken.")).toBeVisible()
  await page.screenshot({ path: info.outputPath('w1-home.png') })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByTestId('devreply.panel')).toBeHidden()

  await startNew(page, 'idea', `Web notice test ${nonce}`)
  const notice = page.getByTestId('devreply.notice')
  await expect(notice).toContainText('Please allow up to 3 working days for a reply')
  await expect(notice).toContainText("You'll see it right here.")
  const field = page.getByTestId('devreply.emailask.field')
  await expect(field).toBeVisible()
  await expect(page.getByTestId('devreply.composer')).toBeFocused() // the keyboard stays with the composer
  await page.screenshot({ path: info.outputPath('w2-notice-email-ask.png') })

  await field.fill('not-an-email')
  await page.getByTestId('devreply.emailask.save').click()
  await expect(page.getByRole('alert')).toContainText(/email/i)
  await field.fill(`web-${nonce}@example.com`)
  await page.getByTestId('devreply.emailask.save').click()
  await expect(field).toBeHidden()
  await expect(notice).toContainText(`We'll also email you at web-${nonce}@example.com.`)

  // Enter sends with a keyboard and mouse (Shift+Enter is a new line); on touch screens Return is a
  // new line and the send button sends.
  const composer = page.getByTestId('devreply.composer')
  const fine = await page.evaluate(() => matchMedia('(pointer: fine)').matches)
  await composer.fill('Second line one')
  await composer.press(fine ? 'Shift+Enter' : 'Enter')
  await composer.pressSequentially('line two')
  if (fine) await composer.press('Enter')
  else await page.getByTestId('devreply.send').click()
  await expect(page.getByText('Second line one\nline two')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Sending…')).toHaveCount(0, { timeout: 15_000 })
  await expect(composer).toHaveValue('')
  await page.screenshot({ path: info.outputPath('w3-email-saved.png') })

  // The host page's rude CSS never reaches the chat.
  const bubble = page.locator('.bubble.me').first()
  expect(await bubble.evaluate((e) => getComputedStyle(e).fontFamily)).toContain('DevReply Space Grotesk')
  expect(await bubble.evaluate((e) => getComputedStyle(e).color)).toBe('rgb(255, 255, 255)')

  // Back home: listed; a new request doesn't ask for the email again.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByText('Second line one')).toBeVisible()
  await page.getByTestId('devreply.start.question').click()
  await page.getByTestId('devreply.composer').fill(`Another question ${nonce}`)
  await page.getByTestId('devreply.send').click()
  await expect(page.getByTestId('devreply.notice')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('devreply.emailask.field')).toHaveCount(0)
})

test('a reply shows on the launcher; one click opens it', async ({ page }, info) => {
  await load(page)
  await startNew(page, 'question', `Bubble test ${nonce}`)
  await page.getByTestId('devreply.emailask.skip').click().catch(() => undefined)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('devreply.panel')).toBeHidden()

  const launcher = page.getByTestId('devreply.launcher')
  await expect(launcher).toHaveAccessibleName(/New reply from/, { timeout: 90_000 })
  await expect(page.locator('#unread')).toHaveText('1')
  await page.screenshot({ path: info.outputPath('w4-launcher-badge.png') })
  await launcher.click()
  await expect(page.getByText(`Founder reply ${nonce}`, { exact: true })).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: info.outputPath('w5-opened-reply.png') })
  await page.keyboard.press('Escape')
  await expect(launcher).toHaveAccessibleName(/Chat with/, { timeout: 10_000 })
  await expect(page.locator('#unread')).toHaveText('0')
})

test('launcher "unread": hidden until a reply waits; the site opens the chat itself @smoke', async ({ page }) => {
  await load(page, 'unread')
  await expect(page.locator('#devreply-root')).toBeAttached()
  await page.waitForTimeout(1500)
  await expect(page.getByTestId('devreply.launcher')).toHaveCount(0)
  await page.locator('#help').click() // DevReply.open('bug')
  await expect(page.getByTestId('devreply.panel')).toBeVisible()
  await expect(page.getByText("Something's broken").first()).toBeVisible()
})

test('a photo goes up and shows in the thread', async ({ page }, info) => {
  await load(page)
  await startNew(page, 'bug', `Photo test ${nonce}`)
  // A generated 300×200 PNG, picked through the photo input.
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 300
    c.height = 200
    const g = c.getContext('2d')!
    g.fillStyle = '#FF5FA2'
    g.fillRect(0, 0, 300, 200)
    g.fillStyle = '#111'
    g.fillRect(40, 40, 120, 80)
    return c.toDataURL('image/png').split(',')[1]
  })
  await page.getByTestId('devreply.photos').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.locator('.thumb img')).toBeVisible()
  await page.getByTestId('devreply.send').click()
  const photo = page.locator('.photo img').last()
  await expect(photo).toHaveAttribute('src', /^https:\/\/storage\.googleapis\.com\//, { timeout: 30_000 })
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 }).toBe(300)
  await page.screenshot({ path: info.outputPath('w6-photo.png') })
})

test('on a phone the chat takes the whole screen @phone', async ({ page }, info) => {
  await load(page)
  await page.getByTestId('devreply.launcher').click()
  const box = await page.getByTestId('devreply.panel').boundingBox()
  const viewport = page.viewportSize()!
  expect(box?.width).toBe(viewport.width)
  expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(viewport.height - 1)
  await expect(page.getByTestId('devreply.launcher')).toBeHidden()
  await page.getByTestId('devreply.start.bug').click()
  await page.screenshot({ path: info.outputPath('w7-phone.png') })
})

test('the published script works from another site, fonts included @smoke', async ({ page }) => {
  const src = 'https://api.devreply.com/sdk/web/v0/devreply.js'
  await page.goto(`/?key=${pk}&src=${encodeURIComponent(src)}`)
  await page.getByTestId('devreply.launcher').click()
  await expect(page.getByTestId('devreply.panel')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px "DevReply Space Grotesk"') && document.fonts.check('16px "DevReply Archivo Black"')), { timeout: 10_000 }).toBe(true)
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((f) => f.family.includes('DevReply') && f.status === 'loaded').length
  })
  expect(loaded).toBe(2)
  expect(await page.evaluate(() => window.DevReply?.version)).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
})

test('a long chat: every new message shows at the bottom, above the composer @smoke', async ({ page }) => {
  await load(page)
  await startNew(page, 'bug', `Long test ${nonce} 1`)
  await page.getByTestId('devreply.emailask.skip').click().catch(() => undefined)
  const composer = page.getByTestId('devreply.composer')
  for (let i = 2; i <= 12; i++) {
    await composer.fill(`Long test ${nonce} ${i}`)
    await page.getByTestId('devreply.send').click()
    const msg = page.getByText(`Long test ${nonce} ${i}`, { exact: true })
    await expect(msg).toBeInViewport({ ratio: 1 })
    const box = await msg.boundingBox()
    const top = (await composer.boundingBox())!.y
    expect(box!.y + box!.height).toBeLessThanOrEqual(top)
  }
  // Sent in the order typed, even when sent quickly (the server's order, after a reload of the thread).
  await page.waitForTimeout(3500)
  const texts = await page.locator('.bubble.me').allInnerTexts()
  const mine = texts.filter((t) => t.startsWith(`Long test ${nonce} `)).map((t) => Number(t.split(' ').pop()))
  expect(mine).toEqual([...mine].sort((a, b) => a - b))
})

test('the npm package works in an app of its own: no globals, fonts from DevReply @smoke', async ({ page }) => {
  await page.goto(`/module.html?key=${pk}&launcher=none`)
  await expect.poll(() => page.evaluate(() => (window as unknown as { ready?: string }).ready)).toBe(
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  )
  expect(await page.evaluate(() => 'DevReply' in window)).toBe(false)
  await expect(page.getByTestId('devreply.launcher')).toHaveCount(0)
  await page.locator('#help').click()
  await expect(page.getByTestId('devreply.panel')).toBeVisible()
  await expect(page.getByText('What would you like to know?')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px "DevReply Space Grotesk"')), { timeout: 10_000 }).toBe(true)
})
