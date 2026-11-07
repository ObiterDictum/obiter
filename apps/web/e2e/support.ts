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
