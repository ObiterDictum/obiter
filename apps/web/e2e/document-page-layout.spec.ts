import { createAccount, openFixtureDocument } from './document-journey'

import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * E5 browser journey: the Layout ribbon's Margins, Orientation and Page size
 * controls must write the body section, and the Insert ribbon's Page break and
 * Section break must split the document. Only a real browser decides the
 * painted sheets and a fresh context reading the stored `w:sectPr` and breaks
 * back; the mounted suites cover the save plan and the writer round-trip.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; verification is marked directly in the task-owned test database,
 * never the shared one. The fixture is the repo's synthetic demo document.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(
  HERE,
  '../../../data/evals/redact/demo-fixture.docx',
)
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
const shots = process.env.E5_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const save = (page: Page) => page.getByRole('button', { name: 'Save' })
const tabs = (page: Page) =>
  page.getByRole('tab', { name: /Home|Insert|Layout/ })

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'Layout') {
  await tabs(page).filter({ hasText: name }).first().click()
}

async function focusHeading(page: Page) {
  const target = page
    .locator('[data-paragraph-id]', { hasText: HEADING })
    .first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.click()
    const focused = await expect(editor(page))
      .toBeFocused()
      .then(() => true)
      .catch(() => false)
    if (focused) return
  }
  throw new Error('could not focus the fixture heading')
}

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

type EditBody = { operations?: Array<Record<string, unknown>> }

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

test.use({ viewport: { width: 1440, height: 900 } })

test('page setup and breaks save and reload', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E5')
  const matter = `E5 layout ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, FIXTURE)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await openRibbon(page, 'Layout')
  await page.getByLabel('Margins', { exact: true }).selectOption('narrow')
  await page.getByRole('button', { name: 'Orientation' }).click()
  await expect(
    page.getByRole('button', { name: 'Orientation' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Page size', { exact: true }).selectOption('legal')
  await shot(page, '01-page-setup')

  const sheetsBefore = await page.getByLabel('Document page').count()
  await focusHeading(page)
  await openRibbon(page, 'Insert')
  await page.getByRole('button', { name: 'Page break' }).click()
  await page.getByRole('button', { name: 'Section break' }).click()
  await expect
    .poll(() => page.getByLabel('Document page').count())
    .toBeGreaterThan(sheetsBefore)
  await shot(page, '02-breaks')

  await saveAndWait(page)
  await shot(page, '03-saved')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_section_properties',
      margins: {
        top: 720,
        right: 720,
        bottom: 720,
        left: 720,
        header: 720,
        footer: 720,
      },
    }),
  )
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_section_properties',
      orientation: 'landscape',
    }),
  )
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'insert_break', kind: 'page' }),
  )
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'insert_section_break' }),
  )

  // A fresh context reads the stored section and breaks back: the margins,
  // orientation and page size come only from the saved document, and the
  // breaks make it paginate onto more than one sheet.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, FIXTURE)
    await openRibbon(reloaded, 'Layout')
    await expect(reloaded.getByLabel('Margins', { exact: true })).toHaveValue(
      'narrow',
    )
    await expect(
      reloaded.getByRole('button', { name: 'Orientation' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(reloaded.getByLabel('Page size', { exact: true })).toHaveValue(
      'legal',
    )
    await expect
      .poll(() => reloaded.getByLabel('Document page').count())
      .toBeGreaterThan(1)
    await shot(reloaded, '04-reopened')
  } finally {
    await fresh.close()
  }
})
