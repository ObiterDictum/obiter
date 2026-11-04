import { expect, type APIRequestContext, type Page } from '@playwright/test'
import path from 'node:path'
import { openMatter, seedAccount } from './support'
import { signIn } from './e13-support'

export async function createAccount(
  _request: APIRequestContext,
  label: string,
) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `${label.toLowerCase()}-${runId}@obiter.test`
  const password = `${label}-${runId}-Aa1!`
  seedAccount(email, password, `${label} User`)
  return { email, password }
}

export async function openFixtureDocument(
  page: Page,
  email: string,
  password: string,
  matterName: string,
  fixture: string,
) {
  await signIn(page, email, password)

  await openMatter(page, matterName)

  const fixtureName = path.basename(fixture)
  if ((await page.getByText(fixtureName).count()) === 0) {
    const fileInput = page
      .getByLabel('Upload document', { exact: true })
      .first()
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles(fixture)
  }
  const documentRow = page.getByText(fixtureName).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()

  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}
