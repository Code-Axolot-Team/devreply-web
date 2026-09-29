import { type Page, expect, test } from '@playwright/test'

// SDK 0.4.3 (spec 03, 05): login labels the user, logout forgets this browser's chat, deleteUser
// erases the user. Live, like chat.spec.ts. Needs DEVREPLY_TEST_PK (a throwaway app's web key).
const pk = process.env.DEVREPLY_TEST_PK ?? ''
const nonce = String(Date.now() % 100000)

test.skip(!pk.startsWith('pk_'), 'DEVREPLY_TEST_PK not set')

type Api = {
  login(id: string): void
  logout(): void
  deleteUser(): Promise<boolean>
}

async function write(page: Page, text: string) {
  await page.getByTestId('devreply.launcher').click()
  await page.getByTestId('devreply.start.question').click()
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
  await page.getByRole('button', { name: 'Close', exact: true }).click()
}

async function home(page: Page) {
  await page.getByTestId('devreply.launcher').click()
  await expect(page.getByTestId('devreply.panel')).toBeVisible()
}

test('login, logout and deleteUser', async ({ page }, info) => {
  await page.goto(`/?key=${pk}&launcher=always`)
  const dr = () => page.evaluate(() => (window as unknown as { DevReply: Api }).DevReply !== undefined)
  await expect.poll(dr).toBe(true)

  // Ana signs in and writes; after logout the browser shows none of it.
  await page.evaluate(() => (window as unknown as { DevReply: Api }).DevReply.login('web-ana'))
  await write(page, `Ana web ${nonce}`)
  await page.evaluate(() => (window as unknown as { DevReply: Api }).DevReply.logout())
  await home(page)
  await expect(page.getByText(`Ana web ${nonce}`)).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('i1-after-logout.png') })
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  // Ben signs in, writes, deletes his account: gone, and the next start is empty.
  await page.evaluate(() => (window as unknown as { DevReply: Api }).DevReply.login('web-ben'))
  await write(page, `Ben web ${nonce}`)
  const ok = await page.evaluate(() => (window as unknown as { DevReply: Api }).DevReply.deleteUser())
  expect(ok).toBe(true)
  await home(page)
  await expect(page.getByText(`Ben web ${nonce}`)).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('i2-after-delete.png') })
})
