import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fixturePath } from './support'

/*
 * E3 browser journey: Align, Line spacing and Indent must agree end to end.
 * Only a real browser decides the painted paragraph CSS, the native selection
 * the custom selection mirrors, and a fresh context reading the stored version
 * back; the mounted suites cover the projection and the save plan.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; verification is marked directly in the task-owned test database,
 * never the shared one. The fixture is the repo's synthetic DOCX.
 */

/** The fixture's first paragraph; stable across a save. */
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
// Set to a directory to capture the journey stage by stage; a normal run
// writes nothing.
const shots = process.env.E3_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const alignCentre = (page: Page) =>
  page.getByRole('button', { name: 'Align centre' })
const lineSpacing = (page: Page) =>
  page.getByLabel('Line spacing', { exact: true })
const indent = (page: Page) => page.getByLabel('Indent', { exact: true })

/** The inline paragraph layout the browser paints on the target block. */
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
  await lineSpacing(page).selectOption('1.5')
  await expect(lineSpacing(page)).toHaveValue('1.5')

  await page.getByRole('tab', { name: 'Layout' }).click()
  await indent(page).selectOption('first')
  await expect(indent(page)).toHaveValue('first')

  // The chosen options and the painted paragraph agree: centred text, a 1.5
  // line box, and Word's half-inch first-line indent (720 twips = 48px).
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

  // A fresh context reads the stored version back: the paint and the control
  // values come only from the saved paragraph properties.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, fixturePath())
    await focusParagraph(reloaded, HEADING)
    await expect(alignCentre(reloaded)).toHaveAttribute('aria-pressed', 'true')
    await expect(lineSpacing(reloaded)).toHaveValue('1.5')
    await reloaded.getByRole('tab', { name: 'Layout' }).click()
    await expect(indent(reloaded)).toHaveValue('first')

    const reloadedStyle = await paragraphStyle(reloaded, HEADING)
    expect(reloadedStyle?.textAlign).toBe('center')
    expect(reloadedStyle?.textIndent).toBe('48px')
    await shot(reloaded, '03-paragraph-formatting-reopened')
  } finally {
    await fresh.close()
  }
})
