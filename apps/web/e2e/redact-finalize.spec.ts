import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { fixturePath, verifyEmailInDb } from './support'

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()

test('finalizes a DOCX into a previewable secure PDF download', async ({
  page,
  request,
}) => {
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
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })
  await page.waitForLoadState('networkidle')

  await page.goto('/redact', { waitUntil: 'networkidle' })
  await page
    .getByLabel('Upload a document to redact')
    .setInputFiles(fixturePath())

  await expect(page).toHaveURL(/\/redact\/red_/, { timeout: 60_000 })

  const listbox = page.getByRole('listbox', { name: 'Detected spans' })
  await listbox.focus()
  const unreviewed = page.getByRole('tab', { name: /^Unreviewed/u })
  const total = Number(
    (await page.getByRole('tab', { name: /^All/u }).textContent())?.replace(
      /\D+/gu,
      '',
    ),
  )
  for (let index = 0; index < total; index += 1) {
    const before = Number(
      (await unreviewed.textContent())?.replace(/\D+/gu, ''),
    )
    if (before === 0) break
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('tab', { name: `Unreviewed ${before - 1}` }),
    ).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('ArrowDown')
  }
  await expect(unreviewed).toHaveText('Unreviewed 0', { timeout: 20_000 })

  await expect(
    page.getByRole('button', { name: 'Finalise', exact: true }),
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Finalise', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Finalise this redaction?' }),
  ).toBeVisible()
  const acknowledgements = page.getByRole('checkbox')
  for (let index = 0; index < (await acknowledgements.count()); index += 1)
    await acknowledgements.nth(index).check()
  await page.getByRole('button', { name: 'Finalise redacted PDF' }).click()

  await expect(
    page.getByRole('heading', { name: 'Redaction finalised' }),
  ).toBeVisible({ timeout: 30_000 })
  await page.screenshot({
    path: `/tmp/redact-finalized-${runId}.png`,
    fullPage: true,
  })
  await expect(
    page.getByRole('heading', { name: 'Disclosure copy' }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByText(
      'Check every page of the preview before you download or share this copy.',
    ),
  ).toBeVisible()
  await expect(
    page.getByText('The schedule lists decisions, not the words removed.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Export Word' })).toBeEnabled()
  await expect(
    page.getByText('Word document unavailable — text file provided instead'),
  ).toBeHidden()

  const downloadButton = page.getByRole('button', { name: 'Download PDF' })
  await expect(page.getByText(/^Preview ready · /u)).toBeVisible({
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
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')

  console.log(`finalized screenshot: /tmp/redact-finalized-${runId}.png`)
})
