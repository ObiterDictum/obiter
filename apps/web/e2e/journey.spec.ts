import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_ORIGIN = process.env.OBITER_API_ORIGIN ?? 'http://127.0.0.1:8787'
// Reuse the synthetic fixture already in the repo — fictional names only.
const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'

function fixturePath() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, FIXTURE_REL)
}

function verifyEmailInDb(email: string) {
  // Mark the better-auth user as verified so sign-in succeeds (requireEmailVerification=true).
  const safe = email.replace(/'/g, "''")
  const sql = `update users set "emailVerified"=true where email='${safe}'`
  execFileSync(
    'docker',
    [
      'exec',
      'obiter-postgres',
      'psql',
      '-U',
      'obiter',
      '-d',
      'obiter',
      '-c',
      sql,
    ],
    {
      stdio: 'pipe',
    },
  )
}

test('sign in → create organisation → create matter → upload DOCX → see it listed', async ({
  page,
  request,
}) => {
  const runId =
    Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 5)
  const email = `e2e-${runId}@obiter.test`
  const password = `E2e-${runId}-Aa1!`
  const orgName = `E2E Org ${runId}`
  const matterName = `E2E Matter ${runId}`

  // Seed: create the user via the real sign-up endpoint, then verify directly in DB.
  const signUp = await request.post(`${API_ORIGIN}/api/auth/sign-up/email`, {
    data: { name: 'E2E User', email, password },
    headers: { Origin: 'http://localhost:3000' },
  })
  // better-auth returns 200 with { token:null } when verification is required; that's ok.
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy()
  verifyEmailInDb(email)

  // 1. Sign in via UI
  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').click()
  await page.getByLabel('Email').pressSequentially(email, { delay: 10 })
  await page.getByLabel('Password').click()
  await page.getByLabel('Password').pressSequentially(password, { delay: 10 })
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })
  // Home should load — wait for the authenticated shell to finish its current-user fetch
  await expect(page).toHaveURL('/')
  await page.waitForLoadState('networkidle')

  // 2. Create organisation via Settings — the app auto-provisions a
  // "Personal workspace" when an org-less user first hits Matters/Home,
  // so we may already have an org by the time we reach Settings.
  await page.goto('/settings', { waitUntil: 'networkidle' })
  const orgInput = page.getByLabel('Organisation name')
  let hasForm = false
  try {
    await expect(orgInput).toBeVisible({ timeout: 2_000 })
    hasForm = true
  } catch {
    hasForm = false
  }
  if (hasForm) {
    await orgInput.click()
    await orgInput.pressSequentially(orgName, { delay: 10 })
    await page.getByRole('button', { name: 'Create organisation' }).click()
    // Success navigates to "/" but a concurrent auto-provision can 409 — handle both.
    await page.waitForTimeout(1500)
    if (page.url().endsWith('/settings')) {
      // Still on settings — check if org now shows (either our name or auto-provisioned)
      await expect(
        page.getByText(orgName).or(page.getByText('Personal workspace')),
      ).toBeVisible({ timeout: 10_000 })
    } else {
      await page.waitForURL('/', { timeout: 5_000 }).catch(() => {})
      await page.goto('/settings', { waitUntil: 'networkidle' })
      await expect(
        page.getByText(orgName).or(page.getByText('Personal workspace')),
      ).toBeVisible({ timeout: 10_000 })
    }
  } else {
    // Already provisioned (e.g. "Personal workspace") — treat as created.
    await expect(page.getByText('Personal workspace')).toBeVisible({
      timeout: 10_000,
    })
  }

  // 3. Create a matter
  await page.goto('/matters', { waitUntil: 'networkidle' })
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible({ timeout: 10_000 })
  // Open the create-matter dialog
  const createMatterTrigger = page
    .getByRole('button', { name: 'Create matter' })
    .first()
  await createMatterTrigger.click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
  // Dialog inputs — labelled consistently
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
  // Client reference optional — leave blank
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
  // Dialog stays open on success (fields cleared) — close it before checking the list
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 })
  const matterLink = page.getByRole('link', { name: matterName }).first()
  await expect(matterLink).toBeVisible({ timeout: 10_000 })

  // 4. Open matter and upload DOCX
  await matterLink.click()
  await expect(page).toHaveURL(/\/matters\//, { timeout: 10_000 })
  await expect(page.getByText(matterName).first()).toBeVisible({
    timeout: 10_000,
  })

  const fileInput = page.locator('input[aria-label="Upload document"]')
  await expect(fileInput).toBeAttached({ timeout: 10_000 })
  await fileInput.setInputFiles(fixturePath())

  // 5. See it listed — filename appears in the Documents list
  await expect(page.getByText('demo-fixture.docx').first()).toBeVisible({
    timeout: 15_000,
  })
})
