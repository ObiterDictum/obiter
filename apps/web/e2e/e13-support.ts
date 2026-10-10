import { expect, type APIRequestContext, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { verifyEmailInDb } from './support'

/*
 * The helpers every E13 spec family shares: a synthetic account through the
 * real sign-up endpoint, the product's own navigation to an uploaded fixture
 * document, and the editor/save locators the workspaces agree on. Split out
 * when document-e13.spec.ts passed the 500-line ceiling; keeping one copy
 * keeps the families honest about driving the same product path.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const HERE = path.dirname(fileURLToPath(import.meta.url))
export const FIXTURE = path.resolve(HERE, 'fixtures/e4-lists-styles.docx')
export const HEADING = 'E4 Heading'
export const BODY = 'Delta paragraph'

export async function createAccount(request: APIRequestContext) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e13-${runId}@obiter.test`
  const password = `E13-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E13 User', email, password },
    headers: { Origin: webOrigin },
  })
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy()
  verifyEmailInDb(databaseName, email)
  return { email, password }
}

export async function signIn(page: Page, email: string, password: string) {
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
}

export async function openMatterDocument(
  page: Page,
  matterName: string,
  upload?: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.getByRole('link', { name: 'Matters' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible({ timeout: 20_000 })

  const matterLink = page.getByRole('link', { name: matterName }).first()
  if ((await matterLink.count()) === 0) {
    await page.getByRole('button', { name: 'Create matter' }).first().click()
    await page.getByLabel('Matter name').fill(matterName)
    await page.getByLabel('Primary jurisdiction').fill('England & Wales')
    await page
      .getByRole('button', { name: 'Create matter', exact: true })
      .last()
      .click()
    await page
      .getByRole('button', { name: 'Cancel' })
      .click({ timeout: 5_000 })
      .catch(() => undefined)
  }
  await page.getByRole('link', { name: matterName }).first().click()
  await expect(page).toHaveURL(/\/matters\//, { timeout: 20_000 })

  const fileName = upload?.name ?? path.basename(FIXTURE)
  if ((await page.getByText(fileName).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    if (upload) {
      await fileInput.setInputFiles(upload)
    } else {
      await fileInput.setInputFiles(FIXTURE)
    }
  }
  const documentRow = page.getByRole('link', { name: fileName }).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()
  await expect(page).toHaveURL(/\/matters\/[^/?#]+\/documents\/[^/?#]+$/)
  await expect(page.getByRole('link', { name: 'Back to matter' })).toBeVisible({
    timeout: 30_000,
  })
}

export async function openDocx(
  page: Page,
  email: string,
  password: string,
  matterName: string,
) {
  await signIn(page, email, password)
  await openMatterDocument(page, matterName)
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

export const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
export const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true })
export const saveState = (page: Page) =>
  page.locator('[data-save-state]').getAttribute('data-save-state')

export async function focusParagraph(page: Page, text: string) {
  const target = page.locator('[data-paragraph-id]', { hasText: text }).first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.click()
    const focused = await expect(editor(page))
      .toBeFocused()
      .then(() => true)
      .catch(() => false)
    if (focused) return
  }
  throw new Error(`could not focus the paragraph containing "${text}"`)
}

export async function caretAtEnd(page: Page, text: string) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+End')
}

export async function saveAndWait(page: Page) {
  await saveButton(page).click()
  await expect(saveButton(page)).toBeDisabled({ timeout: 30_000 })
}

export async function openRibbonTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true }).first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tab.click()
    const selected = await expect(tab)
      .toHaveAttribute('aria-selected', 'true', { timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (selected) return
  }
}

/** The draft scope a seeded payload must match: tab writer, org, user, doc. */
export async function draftScope(page: Page) {
  const writerId = await page.evaluate(() =>
    window.sessionStorage.getItem('obiter.document-draft.tab'),
  )
  if (!writerId) throw new Error('no draft writer id in session')
  const me = await page.evaluate(async () => {
    const response = await fetch('/api/me', { credentials: 'include' })
    return (await response.json()) as {
      user: { id: string }
      organisation: { id: string }
    }
  })
  const documentId = /\/documents\/([^/?#]+)/.exec(page.url())?.[1]
  if (!documentId) throw new Error('no document id in url')
  const model = await page.evaluate(async (id) => {
    const response = await fetch(`/api/documents/${id}/model`, {
      credentials: 'include',
    })
    return (await response.json()) as { versionId: string }
  }, documentId)
  return {
    writerId,
    organisationId: me.organisation.id,
    userId: me.user.id,
    documentId,
    baseVersionId: model.versionId,
  }
}

export const EMPTY_DRAFT_STATE = {
  drafts: {},
  inserts: [],
  deletedParagraphIds: [],
  extraRuns: {},
  format: {
    emphasis: [],
    paragraphStyles: {},
    numbering: {},
    paragraphFormats: {},
    section: {},
  },
  breaks: [],
  structures: [],
  trackedRejections: [],
}

/**
 * Writes a draft payload shaped exactly like the store's own schema — the
 * state a previous version's persistence left behind. The writer is this
 * tab's own, so the reload adopts it through the real restore path rather
 * than any back door.
 */
export async function seedDraft(
  page: Page,
  state: Record<string, unknown>,
  held: Record<string, unknown>[] = [],
) {
  const scope = await draftScope(page)
  await page.evaluate(
    ({ scope: target, state: draftState, held: heldList }) => {
      const payload = {
        schemaVersion: 1,
        organisationId: target.organisationId,
        userId: target.userId,
        documentId: target.documentId,
        draftId: `seeded-${target.writerId.slice(0, 8)}`,
        writerId: target.writerId,
        status: 'active',
        baseVersionId: target.baseVersionId,
        updatedAt: new Date().toISOString(),
        state: draftState,
        held: heldList,
      }
      window.localStorage.setItem(
        `obiter.document-draft.1.${target.organisationId}.${target.userId}.${target.documentId}.seeded-${target.writerId.slice(0, 8)}`,
        JSON.stringify(payload),
      )
    },
    { scope, state, held },
  )
}
