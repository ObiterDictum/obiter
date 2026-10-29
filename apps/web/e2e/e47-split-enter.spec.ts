import { createAccount } from './document-journey'
import { signIn, focusParagraph } from './e13-support'
import { expect, test, type Page } from '@playwright/test'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/e47-split.docx',
)
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
    await page
      .getByRole('button', { name: /^(New matter|Create the first matter)$/ })
      .first()
      .click()
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

async function caretAfter(page: Page, text: string, offset: number) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+Home')
  for (let step = 0; step < offset; step += 1) {
    await page.keyboard.press('ArrowRight')
  }
}

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
  const { email, password } = await createAccount(request, 'E47')
  const matter = `E47 split ${String(Date.now())}`
  const documentId = await openFixtureDocument(page, email, password, matter)
  expect(documentId).not.toBe('')

  await focusParagraph(page, BOLD)
  expect(
    await page
      .locator('[data-paragraph-id]', { hasText: BOLD })
      .locator('span')
      .first()
      .evaluate((node) => getComputedStyle(node).fontWeight),
  ).toBe('700')

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
  expect(await draftStorage(page)).toContain(PLAIN_RIGHT)
  await shot(page, '01-plain-split')

  await caretAfter(page, BOLD, 10)
  await page.keyboard.press('Enter')
  const boldPending = page.getByLabel('Pending paragraph text').last()
  await expect(boldPending).toBeFocused()
  await expect(boldPending).toHaveValue(BOLD_RIGHT)
  const afterBold = await paintedParagraphTexts(page)
  expect(afterBold).toContain(BOLD_LEFT)
  expect(afterBold).toContain(BOLD_RIGHT)
  await shot(page, '02-bold-split')

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
    expect(stored.indexOf(PLAIN_RIGHT)).toBe(stored.indexOf(PLAIN_LEFT) + 1)
    expect(stored.indexOf(BOLD_RIGHT)).toBe(stored.indexOf(BOLD_LEFT) + 1)
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
