import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveJourneyTargets } from '../journey-target.mjs'

/*
 * E47 browser regression: pressing Enter in the middle of a paragraph must
 * leave the second half visible in the pending paragraph, editable, and
 * stored byte-for-byte after a save and a fresh-context reload. The symptom
 * the card records is browser-only: an empty paragraph with no textarea,
 * which jsdom's zero-size hit testing cannot see. This runs against the
 * isolated editor lane, a synthetic account and a wholly synthetic DOCX.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/e47-split.docx',
)
// Set to a directory to capture the journey stage by stage; a normal run
// writes nothing.
const shots = process.env.E47_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const PLAIN =
  '1. I, Margaret Ellison, of 14 Hartley Terrace, London SW1A 1AA, was born on 3 March 1965.'
const PLAIN_LEFT = PLAIN.slice(0, 30)
const PLAIN_RIGHT = PLAIN.slice(30)
const BOLD = '3. On 3 March 2024, I inspected the property and exhibit ME/1.'
const BOLD_LEFT = BOLD.slice(0, 10)
const BOLD_RIGHT = BOLD.slice(10)

function verifyEmailInDb(email: string) {
  const safe = email.replace(/'/g, "''")
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
      `update users set "emailVerified"=true where email='${safe}'`,
    ],
    { stdio: 'pipe' },
  )
}

async function createAccount(request: APIRequestContext) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e47-${runId}@obiter.test`
  const password = `E47-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E47 User', email, password },
    headers: { Origin: webOrigin },
  })
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy()
  verifyEmailInDb(email)
  return { email, password }
}

async function signIn(page: Page, email: string, password: string) {
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

/** Opens the synthetic fixture through the product's own navigation. */
async function openFixtureDocument(
  page: Page,
  email: string,
  password: string,
  matterName: string,
): Promise<string> {
  await signIn(page, email, password)

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

  const fixtureName = path.basename(FIXTURE)
  if ((await page.getByText(fixtureName).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles(FIXTURE)
  }
  const documentRow = page.getByText(fixtureName).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  const modelResponse = page.waitForResponse(
    (res) => /\/api\/documents\/[^/]+\/model$/u.test(res.url()),
    { timeout: 30_000 },
  )
  await documentRow.click()
  const modelUrl = (await modelResponse).url()
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  return modelUrl.match(/\/api\/documents\/([^/]+)\/model$/u)?.[1] ?? ''
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })

async function focusParagraph(page: Page, text: string) {
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

/** Clicks a paragraph and leaves the caret at a known offset. */
async function caretAfter(page: Page, text: string, offset: number) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+Home')
  for (let step = 0; step < offset; step += 1) {
    await page.keyboard.press('ArrowRight')
  }
}

/** The painted text of every paragraph block, in document order. A focused or
 * pending paragraph keeps its text in the textarea value, not in the static
 * run paint, so both surfaces are read. */
async function paintedParagraphTexts(page: Page): Promise<string[]> {
  return page.locator('[data-paragraph-id]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const field = node.querySelector('textarea')
      if (field instanceof HTMLTextAreaElement) return field.value
      return node.querySelector('[data-paragraph-text]')?.textContent ?? ''
    }),
  )
}

async function draftStorage(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: window.localStorage.length }, (_, index) => {
          const key = window.localStorage.key(index) ?? ''
          return [key, window.localStorage.getItem(key) ?? '']
        }),
      ),
    ),
  )
}

async function storedParagraphTexts(page: Page, documentId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/documents/${id}/model`)
    if (!response.ok) throw new Error(`model fetch ${String(response.status)}`)
    const body = (await response.json()) as {
      model: {
        stories: Array<{
          kind: string
          paragraphs: Array<{ runs: Array<{ text: string }> }>
        }>
      }
    }
    const story = body.model.stories.find((item) => item.kind === 'document')
    return (story?.paragraphs ?? []).map((paragraph) =>
      paragraph.runs.map((run) => run.text).join(''),
    )
  }, documentId)
}

/** The preserved run XML of the stored paragraph whose text is `text`. */
async function storedParagraphFragments(
  page: Page,
  documentId: string,
  text: string,
) {
  return page.evaluate(
    async ({ id, wanted }) => {
      const response = await fetch(`/api/documents/${id}/model`)
      if (!response.ok)
        throw new Error(`model fetch ${String(response.status)}`)
      const body = (await response.json()) as {
        model: {
          stories: Array<{
            kind: string
            paragraphs: Array<{
              runs: Array<{ text: string; preservedXmlFragments: string[] }>
            }>
          }>
        }
      }
      const story = body.model.stories.find((item) => item.kind === 'document')
      const paragraph = (story?.paragraphs ?? []).find(
        (item) => item.runs.map((run) => run.text).join('') === wanted,
      )
      return (paragraph?.runs ?? []).flatMap((run) => run.preservedXmlFragments)
    },
    { id: documentId, wanted: text },
  )
}

test.use({ viewport: { width: 1440, height: 900 } })

test('Enter mid-paragraph keeps the second half painted, editable and stored', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E47 split ${String(Date.now())}`
  const documentId = await openFixtureDocument(page, email, password, matter)
  expect(documentId).not.toBe('')

  // The fixture's bold paragraph really is bold before any split.
  await focusParagraph(page, BOLD)
  expect(
    await page
      .locator('[data-paragraph-id]', { hasText: BOLD })
      .locator('span')
      .first()
      .evaluate((node) => getComputedStyle(node).fontWeight),
  ).toBe('700')

  // 1. Plain paragraph: split at the E47 offset.
  await caretAfter(page, PLAIN, 30)
  await page.keyboard.press('Enter')

  const plainPending = page.getByLabel('Pending paragraph text')
  await expect(plainPending).toBeFocused()
  await expect(plainPending).toHaveValue(PLAIN_RIGHT)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: PLAIN_LEFT }),
  ).toBeVisible()
  const afterPlain = await paintedParagraphTexts(page)
  expect(afterPlain).toContain(PLAIN_LEFT)
  expect(afterPlain).toContain(PLAIN_RIGHT)
  // The full draft (not only the painted first half) survives in storage.
  expect(await draftStorage(page)).toContain(PLAIN_RIGHT)
  await shot(page, '01-plain-split')

  // 2. Bold run: split at the E47 offset; the remainder must survive.
  await caretAfter(page, BOLD, 10)
  await page.keyboard.press('Enter')
  const boldPending = page.getByLabel('Pending paragraph text').last()
  await expect(boldPending).toBeFocused()
  await expect(boldPending).toHaveValue(BOLD_RIGHT)
  const afterBold = await paintedParagraphTexts(page)
  expect(afterBold).toContain(BOLD_LEFT)
  expect(afterBold).toContain(BOLD_RIGHT)
  await shot(page, '02-bold-split')

  // 3. Save, then read the stored document in a fresh browser context.
  const editBodies: Array<{ operations?: Array<Record<string, unknown>> }> = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      editBodies.push(outgoing.postDataJSON())
    }
  })
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled({
    timeout: 30_000,
  })
  expect(editBodies.length).toBeGreaterThan(0)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    const stored = await storedParagraphTexts(reloaded, documentId)
    expect(stored).toContain(PLAIN_LEFT)
    expect(stored).toContain(PLAIN_RIGHT)
    expect(stored).toContain(BOLD_LEFT)
    expect(stored).toContain(BOLD_RIGHT)
    // The remainder is a paragraph of its own, not folded into its neighbour.
    expect(stored.indexOf(PLAIN_RIGHT)).toBe(stored.indexOf(PLAIN_LEFT) + 1)
    expect(stored.indexOf(BOLD_RIGHT)).toBe(stored.indexOf(BOLD_LEFT) + 1)
    // The bold remainder is still bold in the stored document, not just text.
    expect(
      (await storedParagraphFragments(reloaded, documentId, BOLD_RIGHT)).join(
        '',
      ),
    ).toContain('<w:b/>')
    await shot(reloaded, '03-reopened')
  } finally {
    await fresh.close()
  }
})
