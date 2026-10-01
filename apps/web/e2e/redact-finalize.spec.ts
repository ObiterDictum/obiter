import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { fixturePath, verifyEmailInDb } from './support'

// Same lane guards as the journey spec: no shared origin, no shared database.
const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()

/**
 * The P0 regression this guards: a successful DOCX burn must show the Word
 * "ready" copy and no amber downgrade warning, because the stored summary must
 * not carry `outputDowngrade` after a successful burn. The API test in
 * app.test.ts asserts the stored summary; this proves the rendered screen and
 * the real download agree with it.
 */
test('finalizes a DOCX with no downgrade warning and a valid Word download', async ({
  page,
  request,
}) => {
  const runId =
    Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 5)
  const email = `e2e-redact-${runId}@obiter.test`
  const password = `E2e-${runId}-Aa1!`

  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E2E Redact User', email, password },
    headers: { Origin: webOrigin },
  })
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy()
  verifyEmailInDb(databaseName, email)

  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').click()
  await page.getByLabel('Email').pressSequentially(email, { delay: 10 })
  await page.getByLabel('Password').click()
  await page.getByLabel('Password').pressSequentially(password, { delay: 10 })
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })
  await page.waitForLoadState('networkidle')

  // Standalone DOCX upload of the synthetic demo fixture.
  await page.goto('/redact', { waitUntil: 'networkidle' })
  await page.getByLabel('Or upload a document').setInputFiles(fixturePath())

  // Uploading creates the run; open its review screen from the runs list.
  const reviewButton = page.getByRole('button', { name: 'Review' }).first()
  await expect(reviewButton).toBeVisible({ timeout: 30_000 })
  await reviewButton.click()
  await expect(page).toHaveURL(/\/redact\/red_/, { timeout: 20_000 })

  // Finalize in the default redacted mode. The run may ask for the
  // unreviewed-spans and/or degraded-detection acknowledgement; tick both.
  await expect(
    page.getByRole('button', { name: 'Finalize', exact: true }),
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Finalize', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Finalize redaction output' }),
  ).toBeVisible()
  const acknowledgements = page.getByRole('checkbox')
  for (let index = 0; index < (await acknowledgements.count()); index += 1)
    await acknowledgements.nth(index).check()
  await page.getByRole('button', { name: 'Confirm finalize' }).click()

  // Successful DOCX burn: formatted output copy, no downgrade warning.
  await expect(page.getByText('Finalized', { exact: true })).toBeVisible({
    timeout: 20_000,
  })
  await page.screenshot({
    path: `/tmp/redact-finalized-${runId}.png`,
    fullPage: true,
  })
  await expect(
    page.getByText('Redacted document ready to download or share.'),
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByText('Word document unavailable — text file provided instead'),
  ).toBeHidden()

  // The valid DOCX download stays available and produces a real Word package.
  const downloadButton = page.getByRole('button', { name: 'Download' })
  await expect(downloadButton).toBeEnabled({ timeout: 15_000 })
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
  await downloadButton.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.docx$/)
  const savedPath = `/tmp/redact-finalized-${runId}.docx`
  await download.saveAs(savedPath)
  const bytes = readFileSync(savedPath)
  expect(bytes.length).toBeGreaterThan(1000)
  // Word files are zip containers; a valid package starts with the zip magic.
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')

  console.log(`finalized screenshot: /tmp/redact-finalized-${runId}.png`)
})
