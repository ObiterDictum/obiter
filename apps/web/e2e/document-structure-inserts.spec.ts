import { createAccount, openFixtureDocument } from './document-journey'

import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * E6a browser journey: the Insert ribbon's table and picture controls must
 * paint the pending insertion through the same wire model a reloaded document
 * uses, and a fresh context must read the stored `w:tbl` and `w:drawing` back.
 * Only a real browser decides the painted table grid, the decoded image
 * bytes, and the re-parsed identities; the mounted suites cover the fold,
 * the save plan, and the writer round-trip.
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
const shots = process.env.E6A_E2E_SHOTS

/** A 1x1 synthetic PNG — the picker reads its natural size from real bytes. */
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

/** The pending fold and the reload both paint the inserted 3x4 grid. */
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

  // A table anchors to the caret paragraph and paints its grid before save.
  await focusHeading(page)
  await openRibbon(page, 'Insert')
  await page.getByRole('button', { name: 'Insert table' }).click()
  await page.getByLabel('Rows', { exact: true }).fill('3')
  await page.getByLabel('Columns', { exact: true }).fill('4')
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click()
  await expectInsertedTable(page)
  await shot(page, '01-pending-table')

  // The picture input validates real bytes and the drawing paints pending.
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

  // A fresh context reads the stored block back: the same 3x4 grid and the
  // same image count, now resolved from the stored media part.
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
