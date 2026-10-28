import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { mockSession } from './shell-harness'

/*
 * E53 browser journey: Strikethrough, Highlight, Superscript and Subscript
 * must agree end to end. Only a real browser decides the painted run CSS, the
 * native text selection the custom selection mirrors, and a fresh context
 * reading the stored version back; the mounted suites cover the projection and
 * the save plan.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; email verification is marked directly in the task-owned test
 * database, never the shared one. The fixture is the repo's synthetic DOCX.
 */

const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'
/** The fixture's first paragraph; stable across a save. */
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
/** Six code units, so the selection never cuts a surrogate pair. */
const SELECTED = 'IN THE'
// Set to a directory to capture the journey stage by stage; a normal run
// writes nothing.
const shots = process.env.E53_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

function fixturePath() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, FIXTURE_REL)
}

/** A native within-paragraph selection the custom selection mirrors. */
async function selectFirst(page: Page, text: string, units: number) {
  await focusParagraph(page, text)
  await page.keyboard.press('Home')
  for (let step = 0; step < units; step += 1) {
    await page.keyboard.press('Shift+ArrowRight')
  }
}

async function paintedStyle(page: Page, text: string) {
  return page.evaluate((value) => {
    const spans = [
      ...document.querySelectorAll('[data-caret-run-overlay] span'),
    ]
    const match = spans.find((span) => span.textContent === value)
    if (!(match instanceof HTMLElement)) return null
    return {
      textDecoration: match.style.textDecoration,
      backgroundColor: match.style.backgroundColor,
      verticalAlign: match.style.verticalAlign,
      fontWeight: match.style.fontWeight,
    }
  }, text)
}

/** The painted state each control's aria-pressed must agree with. */
async function expectPressedAgreesWithPaint(page: Page, text: string) {
  const style = await paintedStyle(page, text)
  const pressed = async (name: string) =>
    (await page.getByRole('button', { name }).getAttribute('aria-pressed')) ===
    'true'
  expect(await pressed('Strikethrough')).toBe(
    style?.textDecoration.includes('line-through') ?? false,
  )
  expect(await pressed('Highlight')).toBe((style?.backgroundColor ?? '') !== '')
  expect(await pressed('Superscript')).toBe(style?.verticalAlign === 'super')
  expect(await pressed('Subscript')).toBe(style?.verticalAlign === 'sub')
}

async function enableTracking(page: Page) {
  await page.getByRole('tab', { name: 'Review' }).click()
  await page.getByRole('button', { name: 'Track changes off' }).click()
  await page.getByRole('tab', { name: 'Home' }).click()
}

type EditBody = {
  trackChanges?: boolean
  operations?: Array<Record<string, unknown>>
}

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

test.use({ viewport: { width: 1440, height: 900 } })

test('character formatting paints, saves, and reloads from a fresh context', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E53')
  const matter = `E53 format ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await selectFirst(page, HEADING, SELECTED.length)

  await page.getByRole('button', { name: 'Strikethrough' }).click()
  await page.getByRole('button', { name: 'Highlight' }).click()
  await page.getByRole('button', { name: 'Superscript' }).click()

  await expect(
    page.getByRole('button', { name: 'Strikethrough' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Highlight' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('button', { name: 'Superscript' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Subscript' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(await paintedStyle(page, SELECTED)).toMatchObject({
    verticalAlign: 'super',
  })
  expect((await paintedStyle(page, SELECTED))?.textDecoration).toContain(
    'line-through',
  )
  expect((await paintedStyle(page, SELECTED))?.backgroundColor).not.toBe('')
  await expectPressedAgreesWithPaint(page, SELECTED)

  // Superscript and subscript are one slot: choosing subscript releases
  // superscript, and choosing superscript back restores it for the save.
  await page.getByRole('button', { name: 'Subscript' }).click()
  await expect(
    page.getByRole('button', { name: 'Superscript' }),
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Subscript' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect((await paintedStyle(page, SELECTED))?.verticalAlign).toBe('sub')
  await page.getByRole('button', { name: 'Superscript' }).click()
  await expectPressedAgreesWithPaint(page, SELECTED)
  await shot(page, '01-character-formatting-applied')

  await saveAndWait(page)
  await shot(page, '02-character-formatting-saved')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_run_emphasis',
      strikethrough: true,
      highlight: 'yellow',
      vertAlign: 'superscript',
    }),
  )

  // A fresh context reads the stored version back: the pressed state and the
  // painted CSS come only from the saved run properties.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, fixturePath())
    await selectFirst(reloaded, HEADING, SELECTED.length)
    await expect(
      reloaded.getByRole('button', { name: 'Strikethrough' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      reloaded.getByRole('button', { name: 'Highlight' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      reloaded.getByRole('button', { name: 'Superscript' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      reloaded.getByRole('button', { name: 'Subscript' }),
    ).toHaveAttribute('aria-pressed', 'false')
    const reloadedStyle = await paintedStyle(reloaded, SELECTED)
    expect(reloadedStyle?.verticalAlign).toBe('super')
    expect(reloadedStyle?.textDecoration).toContain('line-through')
    expect(reloadedStyle?.backgroundColor).not.toBe('')
    await expectPressedAgreesWithPaint(reloaded, SELECTED)
    await shot(reloaded, '03-character-formatting-reopened')
  } finally {
    await fresh.close()
  }
})

test('queues partial character formatting under track changes and saves it', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E53')
  const matter = `E53 tracked ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await enableTracking(page)
  await selectFirst(page, HEADING, SELECTED.length)

  // A tracked range split is recorded as a w:rPrChange, so every character
  // control stays available and queues a draft instead of refusing.
  for (const label of [
    'Strikethrough',
    'Highlight',
    'Superscript',
    'Subscript',
  ]) {
    await expect(
      page.getByRole('button', { name: label, exact: true }),
    ).toBeEnabled()
  }

  await page.getByRole('button', { name: 'Strikethrough' }).click()
  await page.getByRole('button', { name: 'Superscript' }).click()
  await expect(
    page.getByRole('button', { name: 'Strikethrough' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: 'Superscript' }),
  ).toHaveAttribute('aria-pressed', 'true')
  const trackedStyle = await paintedStyle(page, SELECTED)
  expect(trackedStyle?.textDecoration).toContain('line-through')
  expect(trackedStyle?.verticalAlign).toBe('super')
  await shot(page, '04-tracked-range-queued')

  await saveAndWait(page)

  // The batch flew tracked and addressed the selection as a paragraph range,
  // the address a mid-run split has to carry.
  expect(editBodies.at(-1)?.trackChanges).toBe(true)
  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_run_emphasis',
      paragraphId: expect.any(String),
      from: 0,
      to: SELECTED.length,
      strikethrough: true,
      vertAlign: 'superscript',
    }),
  )
})

/*
 * Tracked property history must never paint as current state. The story
 * parser drops a paragraph `w:pPr` that carries a `w:pPrChange`, so the
 * product-reachable path for this leak is a style's sourceFragment — the
 * journey therefore mocks the wire model with the real fragments rather than
 * uploading a DOCX whose pPr the parser would discard.
 *
 * `Normal` carries two kinds of history: a `w:pPrChange` holding the old
 * paragraph mark's strike/highlight/subscript, and a self-closing
 * `w:rPrChange` immediately before the current `w:b`. Before the repair the
 * first seeded every run with dead properties and the second swallowed the
 * bold flag entirely.
 */
const TRACKED_MATTER_ID = 'mtr_tracked_format'
const TRACKED_DOC_ID = 'doc_tracked_format'
const TRACKED_FILENAME = 'tracked-format.docx'
const TRACKED_TEXT = 'Plain body run stays plain'
const TRACKED_SELECTED = 'Plain'

const TRACKED_STYLE_XML =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
  '<w:name w:val="Normal"/>' +
  '<w:pPr><w:pPrChange w:id="7" w:author="Historic" w:date="2026-01-01T00:00:00Z">' +
  '<w:pPr><w:rPr><w:strike/><w:highlight w:val="yellow"/>' +
  '<w:vertAlign w:val="subscript"/></w:rPr></w:pPr></w:pPrChange></w:pPr>' +
  '<w:rPr><w:rPrChange w:id="8" w:author="Historic" ' +
  'w:date="2026-01-01T00:00:00Z"/><w:b/></w:rPr>' +
  '</w:style>'

function trackedRun(id: string, text: string, fragments: string[] = []) {
  return { id, text, preservedXmlFragments: fragments }
}

/** The wire model; `saved` answers the refetch after the edit lands. */
function trackedModel(saved: boolean) {
  return {
    documentId: TRACKED_DOC_ID,
    versionId: saved ? 'ver_2' : 'ver_1',
    versionNumber: saved ? 2 : 1,
    model: {
      version: 1,
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [
            {
              id: 'p1',
              runs: saved
                ? [
                    trackedRun('p1-r1', TRACKED_SELECTED, [
                      '<w:rPr><w:b/><w:strike/></w:rPr>',
                    ]),
                    trackedRun('p1-r2', TRACKED_TEXT.slice(5), [
                      '<w:rPr><w:b/></w:rPr>',
                    ]),
                  ]
                : [trackedRun('p1-r', TRACKED_TEXT)],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
          fields: [],
          unanchoredFieldParagraphIds: [],
        },
      ],
      styles: [{ styleId: 'Normal', sourceFragment: TRACKED_STYLE_XML }],
      numbering: [],
      relationships: [],
      preservedXmlFragments: [],
      changes: [],
      comments: [],
      trackRevisions: false,
      markings: {
        documentKind: null,
        draft: false,
        privileged: false,
        withoutPrejudice: false,
      },
    },
  }
}

async function mockTrackedWorkspace(page: Page, editBodies: EditBody[]) {
  let saved = false
  const matter = {
    id: TRACKED_MATTER_ID,
    organisationId: 'org_shell_test',
    name: 'Tracked Format Matter',
    description: null,
    primaryJurisdiction: 'england-and-wales',
    secondaryJurisdictions: [],
    legalDomains: [],
    clientReference: '',
    status: 'active',
    createdBy: 'usr_shell_test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
  }
  const version = (number: number) => ({
    id: `ver_${String(number)}`,
    organisationId: 'org_shell_test',
    matterId: TRACKED_MATTER_ID,
    matterDocumentId: TRACKED_DOC_ID,
    filename: TRACKED_FILENAME,
    fileType: 'docx',
    sizeBytes: '1024',
    objectKey: `objects/${TRACKED_DOC_ID}/ver_${String(number)}`,
    textObjectKey: null,
    documentStatus: 'ready',
    failureReason: null,
    versionNumber: number,
    contentSha256: 'a'.repeat(64),
    syncState: 'synced',
    createdBy: 'usr_shell_test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  await mockSession(page)
  await page.route('**/api/matters', (route) =>
    route.fulfill({ json: { matters: [matter] } }),
  )
  await page.route(`**/api/matters/${TRACKED_MATTER_ID}`, (route) =>
    route.fulfill({ json: { matter } }),
  )
  await page.route(`**/api/matters/${TRACKED_MATTER_ID}/documents`, (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: TRACKED_DOC_ID,
            organisationId: 'org_shell_test',
            matterId: TRACKED_MATTER_ID,
            currentVersionId: `ver_${saved ? '2' : '1'}`,
            logicalKey: TRACKED_FILENAME,
            createdBy: 'usr_shell_test',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
            deletedBy: null,
            currentVersion: version(saved ? 2 : 1),
          },
        ],
      },
    }),
  )
  await page.route(`**/api/documents/${TRACKED_DOC_ID}`, (route) =>
    route.fulfill({
      json: {
        document: {
          id: TRACKED_DOC_ID,
          organisationId: 'org_shell_test',
          matterId: TRACKED_MATTER_ID,
          currentVersionId: `ver_${saved ? '2' : '1'}`,
          logicalKey: TRACKED_FILENAME,
          createdBy: 'usr_shell_test',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deletedAt: null,
          deletedBy: null,
          currentVersion: version(saved ? 2 : 1),
        },
        versions: [version(1), ...(saved ? [version(2)] : [])],
      },
    }),
  )
  await page.route(`**/api/documents/${TRACKED_DOC_ID}/model`, (route) =>
    route.fulfill({ json: trackedModel(saved) }),
  )
  await page.route(`**/api/documents/${TRACKED_DOC_ID}/edit`, (route) => {
    const body = route.request().postDataJSON()
    if (isEditBody(body)) editBodies.push(body)
    saved = true
    return route.fulfill({
      json: {
        documentId: TRACKED_DOC_ID,
        versionId: 'ver_2',
        versionNumber: 2,
        // The real edit route returns the accepted batch's cross-version
        // lineage; without it the workspace cannot reconcile the history
        // baseline and the save lands blocked rather than saved. Run indexes
        // address the result model below, which splits p1-r at offset 5.
        lineage: {
          version: 1,
          baseVersionId: 'ver_1',
          versionId: 'ver_2',
          acceptedOperations: (editBodies.at(-1)?.operations ?? []).map(
            (_operation, index) => index,
          ),
          paragraphs: [
            {
              fromParagraphId: 'p1',
              toParagraphId: 'p1',
              runs: [
                {
                  runIndex: 0,
                  segments: [{ fromRunId: 'p1-r', fromOffset: 0, toOffset: 5 }],
                },
                {
                  runIndex: 1,
                  segments: [
                    {
                      fromRunId: 'p1-r',
                      fromOffset: 5,
                      toOffset: TRACKED_TEXT.length,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    })
  })
  await page.route(`**/api/documents/${TRACKED_DOC_ID}/comments`, (route) =>
    route.fulfill({
      json: { comments: [], importedComments: [], orphanedReplies: [] },
    }),
  )
  await page.route(
    `**/api/documents/${TRACKED_DOC_ID}/tracked-changes`,
    (route) => route.fulfill({ json: { changes: [] } }),
  )
  await page.route(
    `**/api/documents/${TRACKED_DOC_ID}/collaboration/sync*`,
    (route) =>
      route.fulfill({
        json: {
          changed: false,
          participants: [],
          currentVersionId: `ver_${saved ? '2' : '1'}`,
        },
      }),
  )
  await page.route(
    `**/api/documents/${TRACKED_DOC_ID}/collaboration/presence`,
    (route) => route.fulfill({ json: {} }),
  )
}

/**
 * Client-side navigation, as in the print journey: the route loaders guard
 * during SSR where the mocked session does not apply, so the document is
 * reached through the app shell. Calling it a second time re-reads the model
 * the way a reload would.
 */
async function openTrackedDocument(page: Page) {
  await page.goto('/search')
  const nav = page.getByRole('navigation', { name: 'Workspace' })
  await expect(nav).toBeVisible()
  await nav.getByRole('link', { name: 'Matters' }).first().click()
  await page
    .getByRole('main')
    .getByRole('link', { name: /Tracked Format Matter/ })
    .click()
  // Stage 5 lists a matter's documents as links, not buttons.
  await page
    .getByRole('link', { name: /tracked-format\.docx/ })
    .first()
    .click()
  await expect(page.locator('[data-document-desk]')).toBeVisible()
}

test('tracked property history never paints, presses or saves as current', async ({
  page,
}) => {
  const editBodies: EditBody[] = []
  await mockTrackedWorkspace(page, editBodies)
  await openTrackedDocument(page)

  // The historical paragraph mark seeds nothing: no strike, no highlight, no
  // subscript. The self-closing rPrChange left the current bold alone. The
  // painted run spans exist once the paragraph holds the caret.
  await focusParagraph(page, TRACKED_TEXT)
  const before = await paintedStyle(page, TRACKED_TEXT)
  expect(before?.textDecoration ?? '').not.toContain('line-through')
  expect(before?.backgroundColor ?? '').toBe('')
  expect(before?.verticalAlign ?? '').toBe('')
  expect(before?.fontWeight).toBe('700')

  await selectFirst(page, TRACKED_TEXT, TRACKED_SELECTED.length)
  for (const label of [
    'Bold',
    'Strikethrough',
    'Highlight',
    'Superscript',
    'Subscript',
  ]) {
    await expect(
      page.getByRole('button', { name: label, exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
  }

  await page.getByRole('button', { name: 'Strikethrough' }).click()
  await expect(
    page.getByRole('button', { name: 'Strikethrough' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    (await paintedStyle(page, TRACKED_SELECTED))?.textDecoration,
  ).toContain('line-through')

  // Undo agrees with paint and controls: the toggle reverses, not the history.
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Strikethrough' }),
  ).toHaveAttribute('aria-pressed', 'false')
  expect(
    (await paintedStyle(page, TRACKED_TEXT))?.textDecoration ?? '',
  ).not.toContain('line-through')

  // Re-select 'Plain' before striking again: clicking Undo moved DOM focus to
  // the toolbar, so the paragraph selection no longer stands.
  await selectFirst(page, TRACKED_TEXT, TRACKED_SELECTED.length)
  await page.getByRole('button', { name: 'Strikethrough' }).click()
  await saveAndWait(page)
  // The committed save is only landed once the history boundary resolves
  // against the reloaded model; navigating away before then would persist the
  // covered draft and reopen it as unsaved work.
  await expect
    .poll(() =>
      page.locator('[data-save-state]').getAttribute('data-save-state'),
    )
    .toBe('saved')

  // Only the current change was saved; history never entered the baseline.
  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_run_emphasis',
      paragraphId: 'p1',
      from: 0,
      to: TRACKED_SELECTED.length,
      strikethrough: true,
    }),
  )
  for (const operation of operations) {
    expect(operation.highlight ?? 'none').toBe('none')
    expect(operation.vertAlign ?? 'baseline').toBe('baseline')
  }

  // Reopening re-reads the stored model: strike and bold still agree. The
  // paint is read with the caret on the selection's boundary: parked inside
  // the run it would split the painted span there and no overlay span would
  // carry exactly 'Plain'.
  await openTrackedDocument(page)
  await selectFirst(page, TRACKED_TEXT, TRACKED_SELECTED.length)
  const reopened = await paintedStyle(page, TRACKED_SELECTED)
  expect(reopened?.textDecoration).toContain('line-through')
  expect(reopened?.fontWeight).toBe('700')
  await expect(
    page.getByRole('button', { name: 'Strikethrough' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('button', { name: 'Subscript', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
})
