import { expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveJourneyTargets } from '../journey-target.mjs'

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

export function seedAccount(email: string, password: string, name: string) {
  resolveJourneyTargets()
  const databaseUrl = process.env.OBITER_E2E_DATABASE_URL
  if (!databaseUrl) throw new Error('OBITER_E2E_DATABASE_URL is required')
  const salt = randomBytes(16).toString('hex')
  const key = scryptSync(password.normalize('NFKC'), salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  }).toString('hex')
  const userId = `usr_${randomUUID()}`
  const organisationId = `org_${randomUUID()}`
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
  const sql = `begin;
    insert into organisations (id, name) values (${quote(organisationId)}, 'Personal workspace');
    insert into users (id, name, email, "emailVerified", "organisationId", role)
      values (${quote(userId)}, ${quote(name)}, ${quote(email)}, true, ${quote(organisationId)}, 'owner');
    insert into accounts ("accountId", "providerId", "userId", password)
      values (${quote(userId)}, 'credential', ${quote(userId)}, ${quote(`${salt}:${key}`)});
    commit;`
  execFileSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}
