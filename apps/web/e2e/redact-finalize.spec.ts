import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { fixturePath, verifyEmailInDb } from './support'

// Same lane guards as the journey spec: no shared origin, no shared database.
const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()

/**
 * The journey this guards: a DOCX source is destructively sanitized, rendered to
 * an intermediate PDF by the sandboxed renderer (faked at the HTTP boundary),
 * rasterized into an image-only secure PDF, previewed, and downloaded through
 * the same fetched artifact bytes. The API tests assert the stored summary and
 * the rasterized bytes; this proves the rendered screen, the preview gate and
 * the real download agree with them.
 */
test('finalizes a DOCX into a previewable secure PDF download', async ({
  page,
  request,
}) => {
  // A short hex run id from a CSPRNG labels the synthetic account and the
  // downloaded files. Password material must not be predictable, so this is
  // not Math.random() (CodeQL js/insecure-randomness).
  const runId = randomUUID().slice(0, 8)
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
  await page.getByRole('button', { name: 'Create secure PDF' }).click()

  // Secure PDF: the finalized heading, the preview-before-download copy and no
  // downgrade warning.
  await expect(page.getByText('Finalized', { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await page.screenshot({
    path: `/tmp/redact-finalized-${runId}.png`,
    fullPage: true,
  })
  await expect(
    page.getByRole('heading', { name: 'Secure redacted PDF' }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByText(
      'Preview the finalized file below. Download and share this PDF only after checking every page.',
    ),
  ).toBeVisible()
  await expect(
    page.getByText('Word document unavailable — text file provided instead'),
  ).toBeHidden()

  // The primary download stays disabled until the preview has rendered.
  const downloadButton = page.getByRole('button', {
    name: 'Download secure PDF',
  })
  await expect(page.getByText(/^Preview ready, /)).toBeVisible({
    timeout: 30_000,
  })
  await expect(downloadButton).toBeEnabled({ timeout: 15_000 })
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
  await downloadButton.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/-redacted\.pdf$/)
  const savedPath = `/tmp/redact-finalized-${runId}.pdf`
  await download.saveAs(savedPath)
  const bytes = readFileSync(savedPath)
  expect(bytes.length).toBeGreaterThan(1000)
  // A PDF, not a Word package or plain text.
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')

  console.log(`finalized screenshot: /tmp/redact-finalized-${runId}.png`)
})
