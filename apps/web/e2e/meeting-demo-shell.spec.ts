import { test, expect, type Page } from '@playwright/test'
import { documentWidths, mockSession, modeNav } from './shell-harness'

/**
 * The meeting-demo repairs that can be proven without a database: Verify's
 * identity and live status, the mode rail's expanded width, the search focus
 * rings, and the 390px viewport. The API is mocked at the network boundary so
 * the assertions read rendered layout and focus, not a seeded fixture.
 */

const RUN_ID = 'vrun_6f2ffddc-4c20-4df5-b981-44ea5e1bd4dc'
const DOC_ID = 'doc_9a6135fb-0000-4000-8000-000000000001'
const MATTER_ID = 'mtr_7c1b0000-0000-4000-8000-000000000002'

async function mockVerifyData(page: Page) {
  await page.route('**/api/verification-runs**', (route) =>
    route.fulfill({
      json: {
        runs: [
          {
            id: RUN_ID,
            organisationId: 'org_shell_test',
            matterId: MATTER_ID,
            documentId: DOC_ID,
            documentVersionId: 'ver_9a6135fb-0000-4000-8000-000000000003',
            status: 'completed',
            failureCode: null,
            createdBy: 'usr_shell_test',
            createdAt: '2026-09-14T09:00:00.000Z',
            startedAt: '2026-09-14T09:00:01.000Z',
            completedAt: '2026-09-14T09:00:02.000Z',
            summary: {
              findingCount: 2,
              flaggedCount: 0,
              reviewRequiredCount: 2,
            },
            documentCurrentVersionId:
              'ver_9a6135fb-0000-4000-8000-000000000003',
            stale: false,
          },
        ],
        nextCursor: null,
      },
    }),
  )
  await page.route(`**/api/documents/${DOC_ID}`, (route) =>
    route.fulfill({
      json: {
        document: {
          id: DOC_ID,
          organisationId: 'org_shell_test',
          matterId: MATTER_ID,
          currentVersionId: 'ver_9a6135fb-0000-4000-8000-000000000003',
          logicalKey: 'doc_logical',
          createdBy: 'usr_shell_test',
          createdAt: '2026-09-01T09:00:00.000Z',
          updatedAt: '2026-09-01T09:00:00.000Z',
          deletedAt: null,
          deletedBy: null,
          currentVersion: { filename: 'Potanina-skeleton-argument.docx' },
        },
        versions: [],
      },
    }),
  )
  await page.route('**/api/matters**', (route) =>
    route.fulfill({
      json: {
        matters: [
          {
            id: MATTER_ID,
            organisationId: 'org_shell_test',
            name: 'Potanina v Potanin',
            description: null,
            primaryJurisdiction: 'England & Wales',
            secondaryJurisdictions: [],
            legalDomains: [],
            clientReference: '',
            status: 'active',
            createdBy: 'usr_shell_test',
            createdAt: '2026-09-01T09:00:00.000Z',
            updatedAt: '2026-09-01T09:00:00.000Z',
            deletedAt: null,
            deletedBy: null,
          },
        ],
      },
    }),
  )
  await page.route('**/api/redaction-runs**', (route) =>
    route.fulfill({ json: { runs: [] } }),
  )
}

test('Verify is live, names its runs, and guides an empty list to a document', async ({
  page,
}) => {
  await mockSession(page)
  await mockVerifyData(page)

  await page.goto('/verify')
  await expect(modeNav(page)).toBeVisible()

  // The nav no longer calls a working capability "Soon".
  const verifyMode = modeNav(page).getByRole('link', { name: 'Verify' })
  await expect(verifyMode).toBeVisible()
  await expect(verifyMode).not.toContainText('Soon')

  // Identity is the document and matter, not the run or version UUID.
  await expect(page.getByText('Potanina-skeleton-argument.docx')).toBeVisible()
  await expect(page.getByText(/Potanina v Potanin/)).toBeVisible()
  await expect(
    page.locator('main').getByText('Review required (2)'),
  ).toBeVisible()
  await expect(page.getByText(RUN_ID)).toBeHidden()
  await expect(page.getByRole('link', { name: 'Open document' })).toBeVisible()

  // The stored version stays visible beside the friendly identity.
  await expect(page.getByText(/ver_9a6135fb/)).toBeVisible()
})

test('the verify rail reflects real runs instead of "In development"', async ({
  page,
}) => {
  await mockSession(page)
  await mockVerifyData(page)
  await page.goto('/verify')
  await expect(modeNav(page)).toBeVisible()

  // Expand the left rail so its sections render.
  await page.mouse.move(20, 400)
  const rail = page.locator('aside')
  await expect(rail.getByText('In development')).toHaveCount(0)
  await expect(rail.getByText('Review required (2)').first()).toBeVisible()
  await expect(rail.getByText('Nothing to review')).toHaveCount(0)
})

test('an expanded rail keeps every mode label, including Redact', async ({
  page,
}) => {
  await mockSession(page)
  await mockVerifyData(page)
  await page.goto('/search')
  await expect(modeNav(page)).toBeVisible()

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.mouse.move(20, 400)
  await page.waitForTimeout(400)

  const rail = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Modes"]')
    const rail = nav?.parentElement ?? null
    return {
      scrollWidth: rail?.scrollWidth ?? 0,
      clientWidth: rail?.clientWidth ?? 0,
      labels: [...(nav?.querySelectorAll('a') ?? [])].map((a) =>
        (a.textContent ?? '').trim(),
      ),
    }
  })
  expect(rail.labels).toEqual(['Search', 'Matters', 'Verify', 'Redact'])
  expect(
    rail.scrollWidth,
    `the expanded mode rail still clips at 1440 (scrollWidth ${rail.scrollWidth}, clientWidth ${rail.clientWidth})`,
  ).toBeLessThanOrEqual(rail.clientWidth)
})

test('both search fields show a keyboard focus ring', async ({ page }) => {
  await mockSession(page)
  await mockVerifyData(page)
  await page.goto('/search')
  await expect(modeNav(page)).toBeVisible()

  const topField = page.locator('input[aria-label="Search Obiter"]')
  await topField.focus()
  const top = await topField.evaluate((input) => {
    const pill = input.closest('form')
    const style = pill ? getComputedStyle(pill) : null
    return style
      ? { style: style.outlineStyle, width: style.outlineWidth }
      : null
  })
  expect(top).not.toBeNull()
  expect(top!.style).toBe('solid')
  expect(Number.parseFloat(top!.width)).toBeGreaterThanOrEqual(2)

  const pageField = page.locator('#legal-sources-search')
  await pageField.focus()
  const pageOutline = await pageField.evaluate((input) => {
    const pill = input.closest('div')
    const style = pill ? getComputedStyle(pill) : null
    return style
      ? { style: style.outlineStyle, width: style.outlineWidth }
      : null
  })
  expect(pageOutline).not.toBeNull()
  expect(pageOutline!.style).toBe('solid')
  expect(Number.parseFloat(pageOutline!.width)).toBeGreaterThanOrEqual(2)
})

test('the verify list and its controls fit a 390px viewport', async ({
  page,
}) => {
  await mockSession(page)
  await mockVerifyData(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/verify')
  await expect(modeNav(page)).toBeVisible()

  const openDocument = page.getByRole('link', { name: 'Open document' })
  await expect(openDocument).toBeVisible()
  const box = await openDocument.boundingBox()
  expect(box, 'Open document has no box').not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(391)

  const widths = await documentWidths(page)
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth)
})
