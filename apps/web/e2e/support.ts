import { expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'

export function fixturePath() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, FIXTURE_REL)
}

export async function waitForPaneIdle(page: Page) {
  await expect(page.locator('#app-shell-pane [aria-busy="true"]')).toHaveCount(
    0,
  )
}

export async function showRedactionSpans(page: Page) {
  const listbox = page.getByRole('listbox', { name: 'Detected spans' })
  if (await listbox.isVisible()) return
  await page
    .getByRole('group', { name: 'Review view' })
    .getByRole('button', { name: 'Spans' })
    .click()
  await expect(listbox).toBeVisible()
}

export async function decideEverySpan(page: Page) {
  await showRedactionSpans(page)
  const unreviewed = page.getByRole('tab', { name: /^Unreviewed/u })
  await unreviewed.click()
  const listbox = page.getByRole('listbox', { name: 'Detected spans' })
  for (let guard = 0; guard < 60; guard += 1) {
    const remaining = Number(
      (await unreviewed.textContent())?.replace(/\D+/gu, ''),
    )
    if (remaining === 0) return
    await listbox.getByRole('option').first().click()
    await page.keyboard.press('Enter')
    await expect(unreviewed).toHaveText(`Unreviewed ${remaining - 1}`, {
      timeout: 20_000,
    })
  }
  await expect(unreviewed).toHaveText('Unreviewed 0', { timeout: 20_000 })
}

export async function openMatter(page: Page, matterName: string) {
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: /^Matters(?:,|$)/ })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible()
  await waitForPaneIdle(page)
  const matterLink = page
    .getByRole('main')
    .getByRole('link', { name: `Open ${matterName}`, exact: true })
  if (await matterLink.count()) {
    await matterLink.first().click()
  } else {
    await page
      .getByRole('button', { name: /^(New matter|Create a matter)$/ })
      .click()
    await page.getByLabel('Matter name').fill(matterName)
    await page.getByLabel('Primary jurisdiction').fill('England & Wales')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create matter', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toBeHidden()
  }
  await expect(page).toHaveURL(/\/matters\/[^/?#]+$/)
  await expect(
    page.getByRole('heading', { name: matterName, exact: true }),
  ).toBeVisible()
  await waitForPaneIdle(page)
}

export function verifyEmailInDb(databaseName: string, email: string) {
  const safe = email.replace(/'/g, "''")
  const sql = `update users set "emailVerified"=true where email='${safe}'`
  try {
    execFileSync(
      'psql',
      ['-v', 'ON_ERROR_STOP=1', '-d', databaseName, '-c', sql],
      { stdio: 'pipe' },
    )
  } catch {
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
      { stdio: 'pipe' },
    )
  }
}

export async function dismissWelcomeGuide(page: Page) {
  const response = await page.request.get('/api/me')
  expect(response.ok()).toBeTruthy()
  const { welcomeGuide } = await response.json()
  if (welcomeGuide?.seenAt !== null) return

  const saved = page.waitForResponse(
    (result) =>
      new URL(result.url()).pathname === '/api/me/welcome-guide' &&
      result.request().method() === 'POST',
  )
  const guide = page.getByRole('dialog', { name: 'Welcome to Obiter' })
  await guide.getByRole('button', { name: 'Skip' }).click()
  expect((await saved).ok()).toBeTruthy()
  await expect(guide).toBeHidden()
}
