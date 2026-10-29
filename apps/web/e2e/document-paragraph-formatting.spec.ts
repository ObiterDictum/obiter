import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fixturePath } from './support'
import { choose, openFormatting, selectedValue } from './editor-chrome'

const HEADING = 'IN THE HIGH COURT OF JUSTICE'
const shots = process.env.E3_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const alignCentre = (page: Page) =>
  page.getByRole('button', { name: 'Align centre' })
const lineSpacing = (page: Page) => selectedValue(page, 'Line spacing')
const indent = (page: Page) => selectedValue(page, 'Indent')

async function paragraphStyle(page: Page, text: string) {
  return page.evaluate((value) => {
    const roots = [...document.querySelectorAll('[data-paragraph-id]')]
    const match = roots.find((root) => root.textContent?.includes(value))
    if (!(match instanceof HTMLElement)) return null
    return {
      textAlign: match.style.textAlign,
      textIndent: match.style.textIndent,
      lineHeight: match.style.lineHeight,
    }
  }, text)
}

type EditBody = { operations?: Array<Record<string, unknown>> }

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

test.use({ viewport: { width: 1440, height: 900 } })

test('align, line spacing and indent paint, save, and reload from a fresh context', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E3')
  const matter = `E3 paragraph ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await focusParagraph(page, HEADING)
  const defaultStyle = await paragraphStyle(page, HEADING)

  await alignCentre(page).click()
  await expect(alignCentre(page)).toHaveAttribute('aria-pressed', 'true')
  await choose(page, 'Line spacing', '1.5')
  await expect(lineSpacing(page)).toHaveText('1.5')

  await openFormatting(page)
  await choose(page, 'Indent', 'First line')
  await expect(indent(page)).toHaveText('First line')

  const painted = await paragraphStyle(page, HEADING)
  expect(painted?.textAlign).toBe('center')
  expect(painted?.textIndent).toBe('48px')
  expect(Number.parseFloat(painted?.lineHeight ?? '0')).toBeGreaterThan(
    Number.parseFloat(defaultStyle?.lineHeight ?? '0'),
  )
  await shot(page, '01-paragraph-formatting-applied')

  await saveAndWait(page)
  await shot(page, '02-paragraph-formatting-saved')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_paragraph_format',
      alignment: 'center',
      lineSpacing: { line: 360, lineRule: 'auto' },
      indentation: { firstLine: 720 },
    }),
  )

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, fixturePath())
    await focusParagraph(reloaded, HEADING)
    await expect(alignCentre(reloaded)).toHaveAttribute('aria-pressed', 'true')
    await openFormatting(reloaded)
    await expect(lineSpacing(reloaded)).toHaveText('1.5')
    await expect(indent(reloaded)).toHaveText('First line')

    const reloadedStyle = await paragraphStyle(reloaded, HEADING)
    expect(reloadedStyle?.textAlign).toBe('center')
    expect(reloadedStyle?.textIndent).toBe('48px')
    await shot(reloaded, '03-paragraph-formatting-reopened')
  } finally {
    await fresh.close()
  }
})
