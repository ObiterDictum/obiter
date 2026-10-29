import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { fixturePath, verifyEmailInDb } from './support'

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()

test('sign in → create organisation → create matter → upload DOCX → see it listed', async ({
  page,
  request,
}) => {
  const runId = randomUUID().slice(0, 8)
  const email = `e2e-${runId}@obiter.test`
  const password = `E2e-${runId}-Aa1!`
  const orgName = `E2E Org ${runId}`
  const matterName = `E2E Matter ${runId}`

  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E2E User', email, password },
    headers: { Origin: webOrigin },
  })
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy()
  verifyEmailInDb(databaseName, email)

  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').click()
  await page.getByLabel('Email').pressSequentially(email, { delay: 10 })
  await page.getByLabel('Password').click()
  await page.getByLabel('Password').pressSequentially(password, { delay: 10 })
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })
  await expect(page).toHaveURL('/')
  await page.waitForLoadState('networkidle')

  await page.goto('/settings', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Organisation', exact: true }).click()
  const orgInput = page.getByLabel('Organisation name')
  await expect(orgInput).toBeVisible({ timeout: 10_000 })

  const createOrgButton = page.getByRole('button', {
    name: 'Create organisation',
  })
  const expectedOrgName = new RegExp(`^(?:${orgName}|Personal workspace)$`)
  if (await createOrgButton.isVisible()) {
    await orgInput.click()
    await orgInput.pressSequentially(orgName, { delay: 10 })
    await expect(orgInput).toHaveValue(orgName, { timeout: 5_000 })
    await createOrgButton.click()
    await expect(orgInput).toHaveValue(expectedOrgName, { timeout: 10_000 })
  } else {
    await expect(orgInput).toHaveValue(expectedOrgName, { timeout: 10_000 })
  }

  await page.goto('/matters', { waitUntil: 'networkidle' })
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible({ timeout: 10_000 })
  const createMatterTrigger = page
    .getByRole('button', { name: /^(New matter|Create the first matter)$/ })
    .first()
  await createMatterTrigger.click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('Matter name').click()
  await page
    .getByLabel('Matter name')
    .pressSequentially(matterName, { delay: 10 })
  await expect(page.getByLabel('Matter name')).toHaveValue(matterName, {
    timeout: 5_000,
  })
  await page.getByLabel('Primary jurisdiction').click()
  await page
    .getByLabel('Primary jurisdiction')
    .pressSequentially('England & Wales', { delay: 10 })
  await expect(page.getByLabel('Primary jurisdiction')).toHaveValue(
    'England & Wales',
    { timeout: 5_000 },
  )
  const createResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/matters') && r.request().method() === 'POST',
    { timeout: 10_000 },
  )
  await page
    .getByRole('button', { name: 'Create matter', exact: true })
    .last()
    .click()
  const createResponse = await createResponsePromise
  expect(
    createResponse.ok(),
    `create matter failed: ${await createResponse.text()}`,
  ).toBeTruthy()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 })
  const matterLink = page.getByRole('link', { name: matterName }).first()
  await expect(matterLink).toBeVisible({ timeout: 10_000 })

  await matterLink.click()
  await expect(page).toHaveURL(/\/matters\//, { timeout: 10_000 })
  await expect(page.getByText(matterName).first()).toBeVisible({
    timeout: 10_000,
  })

  const fileInput = page.locator('input[aria-label="Upload document"]')
  await expect(fileInput).toBeAttached({ timeout: 10_000 })
  await fileInput.setInputFiles(fixturePath())

  await expect(page.getByText('demo-fixture.docx').first()).toBeVisible({
    timeout: 15_000,
  })
})
