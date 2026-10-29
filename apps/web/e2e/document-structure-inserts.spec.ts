import { createAccount, openFixtureDocument } from './document-journey'

import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRibbonTab } from './editor-chrome'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(
  HERE,
  '../../../data/evals/redact/demo-fixture.docx',
)
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
const shots = process.env.E6A_E2E_SHOTS

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const save = (page: Page) => page.getByRole('button', { name: 'Save' })

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'Layout') {
  await openRibbonTab(page, name)
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

function expectInsertedTable(page: Page) {
  return expect
    .poll(async () =>
      page.$$eval(
        'table',
        (tables) =>
          tables.filter(
            (table) =>
              table.rows.length === 3 &&
              [...table.rows].every((row) => row.cells.length === 4),
          ).length,
      ),
    )
    .toBe(1)
}

type EditBody = { operations?: Array<Record<string, unknown>> }

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

test.use({ viewport: { width: 1440, height: 900 } })

test('table and picture insertions paint, save and reload', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E6a')
  const matter = `E6a inserts ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, FIXTURE)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await focusHeading(page)
  await openRibbon(page, 'Insert')
  await page
    .getByRole('menuitem', { name: 'Insert table', exact: true })
    .click()
  await page.getByLabel('Rows', { exact: true }).fill('3')
  await page.getByLabel('Columns', { exact: true }).fill('4')
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click()
  await expectInsertedTable(page)
  await shot(page, '01-pending-table')

  const imagesBefore = await page.locator('img').count()
  await focusHeading(page)
  await page.locator('input[aria-label="Insert picture"]').setInputFiles({
    name: 'figure.png',
    mimeType: 'image/png',
    buffer: PNG_BYTES,
  })
  await expect.poll(() => page.locator('img').count()).toBe(imagesBefore + 1)
  await shot(page, '02-pending-picture')

  await saveAndWait(page)
  await shot(page, '03-saved')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'insert_table', rows: 3, columns: 4 }),
  )
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'insert_image',
      contentType: 'image/png',
      name: 'figure.png',
    }),
  )

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, FIXTURE)
    await expectInsertedTable(reloaded)
    await expect
      .poll(() => reloaded.locator('img').count())
      .toBe(imagesBefore + 1)
    await shot(reloaded, '04-reloaded')
  } finally {
    await fresh.close()
  }
})
