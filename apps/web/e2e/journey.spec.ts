import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveJourneyTargets } from '../journey-target.mjs'

// The sign-up origin, the Origin header and the psql database resolve together
// from the same lane machinery the Playwright config uses, and resolution
// throws at module load — before any test, hence before any account exists —
// when the origin is absent, invalid or shared, or when the task database is
// not explicitly selected. There is deliberately no fallback to the shared
// dev API.
const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
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
  // The API's database is whatever DATABASE_URL points at, and the Playwright
  // config starts the API from OBITER_E2E_DATABASE_URL. journey-target derives
  // this name from that same variable (refusing the shared `obiter` database
  // and a NAME/URL mismatch), so this update always names the database the API
  // reads — sign-up, verification and sign-in land in one database.
  execFileSync(
    'docker',
    [
      'exec',
      'obiter-postgres',
      'psql',
      '-U',
      'obiter',
      '-d',
      databaseName,
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
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E2E User', email, password },
    headers: { Origin: webOrigin },
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

  // 2. Create organisation via Settings. Settings opens on the Account
  // section; since #210 the organisation form is mounted hidden behind its own
  // nav item, so select it first and then work with the (now visible)
  // Organisation name field. The app auto-provisions a "Personal workspace"
  // when an org-less user first hits Matters/Home, so by now the account may
  // already have an organisation.
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Organisation', exact: true }).click()
  const orgInput = page.getByLabel('Organisation name')
  await expect(orgInput).toBeVisible({ timeout: 10_000 })

  // The create form and the rename form share that label; only the create form
  // has a "Create organisation" submit button.
  const createOrgButton = page.getByRole('button', {
    name: 'Create organisation',
  })
  // orgName embeds only [a-z0-9] run ids, so it is safe inside this regex.
  const expectedOrgName = new RegExp(`^(?:${orgName}|Personal workspace)$`)
  if (await createOrgButton.isVisible()) {
    await orgInput.click()
    await orgInput.pressSequentially(orgName, { delay: 10 })
    await expect(orgInput).toHaveValue(orgName, { timeout: 5_000 })
    await createOrgButton.click()
    // Creating merges the organisation into the cached /api/me and the section
    // re-renders as the rename form carrying the name the server stored. A
    // concurrent auto-provision answers 409 and refetches its provisioned name
    // instead — either way the account now has an organisation.
    await expect(orgInput).toHaveValue(expectedOrgName, { timeout: 10_000 })
  } else {
    // Already provisioned — assert the field really carries an organisation
    // name rather than only that some text appears on the page.
    await expect(orgInput).toHaveValue(expectedOrgName, { timeout: 10_000 })
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
