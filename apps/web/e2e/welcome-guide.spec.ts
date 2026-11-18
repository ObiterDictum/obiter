import { expect, test } from '@playwright/test'
import { createAccount, signIn } from './e13-support'

test('shows the welcome guide once and reopens it from the shell', async ({
  page,
  request,
  browser,
  baseURL,
}, testInfo) => {
  const { email, password } = await createAccount(request)
  const showGuide = { showWelcomeGuide: true }
  await signIn(page, email, password, showGuide)

  const guide = page.getByRole('dialog')
  await expect(guide).toHaveAccessibleName('Welcome to Obiter')
  await expect(guide.getByRole('button', { name: 'Next' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(guide.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await expect(guide.getByText('Step 2 of 8')).toBeVisible()
  await page.keyboard.press('ArrowLeft')

  for (let step = 1; step <= 8; step++) {
    await expect(guide.getByText(`Step ${step} of 8`)).toBeVisible()
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`after-${step}-welcome.png`),
    })
    if (step < 8) await guide.getByRole('button', { name: 'Next' }).click()
  }

  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/me/welcome-guide' &&
      response.request().method() === 'POST',
  )
  await guide.getByRole('button', { name: 'Get started' }).click()
  expect((await saved).ok()).toBe(true)
  await expect(guide).toBeHidden()
  await expect(
    page.getByRole('region', { name: 'Getting started' }),
  ).toBeVisible()

  const other = await browser.newContext({ baseURL })
  try {
    const otherPage = await other.newPage()
    await signIn(otherPage, email, password, showGuide)
    await expect(otherPage.getByRole('dialog')).toHaveCount(0)
  } finally {
    await other.close()
  }

  await page.getByRole('button', { name: 'Account menu' }).click()
  const menuGuide = page.getByText('Welcome guide', { exact: true })
  await expect(menuGuide).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('after-09-account.png'),
  })
  await menuGuide.click()
  await expect(guide).toHaveAccessibleName('Welcome to Obiter')
  await page.keyboard.press('Escape')
  await expect(guide).toBeHidden()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('combobox', { name: 'Search Obiter' })
  await palette.fill('Show welcome guide')
  await palette.press('Enter')
  await expect(guide).toHaveAccessibleName('Welcome to Obiter')
  await page.keyboard.press('Escape')

  await page.goto('/settings?section=preferences')
  const settingsGuide = page.getByRole('button', { name: 'Show welcome guide' })
  await expect(settingsGuide).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('after-10-preferences.png'),
  })
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await settingsGuide.click()
  await expect(guide).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('after-11-dark.png'),
  })
  await page.keyboard.press('Escape')
  await page
    .getByRole('button', { name: 'Light (default)', exact: true })
    .click()
  await page.setViewportSize({ width: 390, height: 844 })
  await settingsGuide.click()
  await guide.getByRole('button', { name: /Step 7/ }).click()
  await expect(guide.getByRole('heading', { name: 'Your data' })).toBeVisible()
  const bounds = await guide.boundingBox()
  expect(bounds?.x).toBeGreaterThanOrEqual(0)
  expect((bounds?.x ?? 390) + (bounds?.width ?? 390)).toBeLessThanOrEqual(390)
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('after-12-mobile.png'),
  })
})
