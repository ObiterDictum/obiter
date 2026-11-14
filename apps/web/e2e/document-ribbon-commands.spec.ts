import { expect, test, type Page } from '@playwright/test'
import { createAccount, openFixtureDocument } from './document-journey'
import { runCommand, saveButton, undoButton, redoButton } from './editor-chrome'
import { openMatter } from './support'
import { signIn } from './e13-support'
import path from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  createSyntheticDocx,
  parseDocx,
  applyDocumentEdits,
  serialiseDocx,
} from '../../../packages/ooxml/src/index'

const commands = [
  ['Insert row above', 3, 2],
  ['Insert row below', 3, 2],
  ['Insert column left', 2, 3],
  ['Insert column right', 2, 3],
  ['Delete row', 1, 2],
  ['Delete column', 2, 1],
  ['Delete table', 0, 0],
] as const

async function shape(page: Page, rows: number, columns: number) {
  const table = page.locator('table').last()
  if (!rows) {
    await expect(page.locator('table')).toHaveCount(0)
    return
  }
  await expect(table.locator('tr')).toHaveCount(rows)
  await expect(table.locator('tr').first().locator('td')).toHaveCount(columns)
}

async function focusCell(page: Page) {
  await page.locator('td [data-paragraph-id]').first().click()
  await expect(page.getByLabel('Paragraph text', { exact: true })).toBeFocused()
}

async function save(page: Page) {
  await saveButton(page).click()
  await expect(saveButton(page)).toBeDisabled({ timeout: 30_000 })
}

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })

for (const saved of [false, true]) {
  test(`${saved ? 'uploaded saved' : 'new blank'} table commands survive undo, redo, save and reload`, async ({
    page,
    request,
  }) => {
    const { email, password } = await createAccount(request, 'Ribbon')
    const matter = `Ribbon ${crypto.randomUUID()}`
    if (saved) {
      const directory = await mkdtemp(path.join(tmpdir(), 'ribbon-'))
      try {
        const document = await parseDocx(
          await createSyntheticDocx(['Table anchor']),
        )
        const paragraphId = document.model.stories[0]?.paragraphs[0]?.id
        if (!paragraphId) throw new Error('Missing table anchor')
        applyDocumentEdits(document, [
          { type: 'insert_table', paragraphId, rows: 2, columns: 2 },
        ])
        const fixture = path.join(directory, 'table.docx')
        await writeFile(fixture, await serialiseDocx(document))
        await openFixtureDocument(page, email, password, matter, fixture)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    } else {
      await signIn(page, email, password)
      await openMatter(page, matter)
      await page
        .getByRole('button', { name: 'New document', exact: true })
        .click()
      await page
        .getByRole('link', { name: 'Untitled.docx', exact: true })
        .first()
        .click()
    }
    await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
      timeout: 30_000,
    })
    if (!saved) {
      await page.locator('[data-paragraph-id]').first().click()
      await runCommand(page, 'Insert table')
      await page.getByLabel('Rows', { exact: true }).fill('2')
      await page.getByLabel('Columns', { exact: true }).fill('2')
      await page
        .getByRole('button', { name: 'Insert', exact: true })
        .last()
        .click()
    }
    if (process.env.EDITOR_SHOTS)
      await page.screenshot({
        path: path.join(
          process.env.EDITOR_SHOTS,
          `${saved ? 'saved' : 'blank'}-table-before.png`,
        ),
      })
    for (const [command, rows, columns] of commands) {
      await focusCell(page)
      await runCommand(page, command)
      await shape(page, rows, columns)
      await undoButton(page).click()
      await shape(page, 2, 2)
      await redoButton(page).click()
      await shape(page, rows, columns)
      await undoButton(page).click()
      await shape(page, 2, 2)
    }
    await focusCell(page)
    await runCommand(page, 'Insert row below')
    await shape(page, 3, 2)
    if (process.env.EDITOR_SHOTS)
      await page.screenshot({
        path: path.join(
          process.env.EDITOR_SHOTS,
          `${saved ? 'saved' : 'blank'}-table-after.png`,
        ),
      })
    await save(page)
    await page.reload()
    await shape(page, 3, 2)
  })
}
