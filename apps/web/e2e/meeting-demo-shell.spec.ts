import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'
import { documentWidths, mockSession, workspaceNav } from './shell-harness'

const RUN_ID = 'vrun_6f2ffddc-4c20-4df5-b981-44ea5e1bd4dc'
const VERSION_ID = 'ver_9a6135fb-0000-4000-8000-000000000003'
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
            documentVersionId: VERSION_ID,
            status: 'completed',
            failureCode: null,
            createdBy: 'usr_shell_test',
            createdAt: '2026-09-14T09:00:00.000Z',
            startedAt: '2026-09-14T09:00:01.000Z',
            completedAt: '2026-09-14T09:00:02.000Z',
            summary: {
              findingCount: 3,
              flaggedCount: 0,
              reviewRequiredCount: 2,
              notCheckedCount: 0,
              dismissedCount: 0,
            },
            documentCurrentVersionId: VERSION_ID,
            stale: false,
          },
        ],
        nextCursor: null,
      },
    }),
  )
  await page.route(`**/api/verification-runs/${RUN_ID}/findings**`, (route) =>
    route.fulfill({
      json: {
        run: {
          id: RUN_ID,
          organisationId: 'org_shell_test',
          matterId: MATTER_ID,
          documentId: DOC_ID,
          documentVersionId: VERSION_ID,
          status: 'completed',
          failureCode: null,
          createdBy: 'usr_shell_test',
          createdAt: '2026-09-14T09:00:00.000Z',
          startedAt: '2026-09-14T09:00:01.000Z',
          completedAt: '2026-09-14T09:00:02.000Z',
          summary: {
            findingCount: 3,
            flaggedCount: 0,
            reviewRequiredCount: 2,
            notCheckedCount: 0,
            dismissedCount: 0,
          },
          documentCurrentVersionId: VERSION_ID,
          stale: false,
        },
        findings: [
          {
            id: 'vf:review-1',
            type: 'citation_resolution',
            state: 'review_required',
            dismissal: null,
            reviewReason: 'citation_unresolved',
            severity: 'medium',
            confidence: 'low',
            requiresReview: true,
            explanation:
              'No stored source in Obiter matches this citation, so there is nothing to check it against.',
            excerpt: '[2099] UKSC 9',
            location: { paragraphId: 'para-000002', start: 0, end: 13 },
            authorityLabel: 'Unmatched citation',
            authorityName: null,
            evidence: [],
          },
          {
            id: 'vf:match-1',
            type: 'quote_fidelity',
            state: 'clear',
            dismissal: null,
            reviewReason: null,
            severity: null,
            confidence: 'high',
            requiresReview: false,
            explanation:
              'The quotation appears in the stored public source as quoted.',
            excerpt: 'the court must consider',
            location: { paragraphId: 'para-000001', start: 0, end: 22 },
            authorityLabel: '[2017] UKSC 24',
            authorityName: 'Wood v Capita Insurance Services Ltd',
            evidence: [],
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
          currentVersion: {
            id: VERSION_ID,
            filename: 'Potanina-skeleton-argument.docx',
            documentStatus: 'ready',
          },
        },
        versions: [
          {
            id: VERSION_ID,
            versionNumber: 3,
            filename: 'Potanina-skeleton-argument.docx',
            documentStatus: 'ready',
          },
        ],
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

async function signInWithMockedVerifyData(
  page: Page,
  request: APIRequestContext,
) {
  const { email, password } = await createAccount(request, 'Demo')
  await mockSession(page)
  await mockVerifyData(page)
  await signIn(page, email, password)
}

async function openVerify(page: Page) {
  await workspaceNav(page)
    .getByRole('link', { name: /^Verify/ })
    .click()
  await expect(page).toHaveURL(/\/verify$/)
}

test('Verify is live, names its runs, and guides an empty list to a document', async ({
  page,
  request,
}) => {
  await signInWithMockedVerifyData(page, request)
  await openVerify(page)
  await expect(workspaceNav(page)).toBeVisible()

  const verifyMode = workspaceNav(page).getByRole('link', {
    name: /^Verify/,
  })
  await expect(verifyMode).toBeVisible()
  await expect(verifyMode).toHaveAttribute('aria-current', 'page')
  await expect(workspaceNav(page).getByText('Soon')).toHaveCount(0)
  await expect(
    workspaceNav(page).getByRole('button', { name: 'Agent' }),
  ).toBeVisible()

  await expect(
    page.locator('main').getByText('Potanina-skeleton-argument.docx'),
  ).toBeVisible()
  await expect(
    page
      .locator('main')
      .getByText(/Potanina v Potanin/)
      .first(),
  ).toBeVisible()
  await expect(page.locator('main').getByText(/2 need review/)).toBeVisible()
  await expect(page.getByText(RUN_ID)).toBeHidden()
  await expect(
    page.locator('main').getByRole('link', { name: 'Open document' }),
  ).toBeVisible()

  await expect(
    page
      .locator('main')
      .getByText(/version 3/)
      .first(),
  ).toBeVisible()
  await expect(page.locator('main').getByText(VERSION_ID)).toBeHidden()

  const matches = page.locator('main').getByRole('button', {
    name: /matches? the checked source/,
  })
  await expect(matches).toHaveAttribute('aria-expanded', 'false')
  await matches.click()
  await expect(matches).toHaveAttribute('aria-expanded', 'true')
  await expect(
    page.locator('main').getByText('Quotation matches checked source'),
  ).toBeVisible()
})

test('both search fields show a keyboard focus ring', async ({ page }) => {
  await mockSession(page)
  await mockVerifyData(page)
  await page.goto('/search')
  await expect(workspaceNav(page)).toBeVisible()

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
  request,
}) => {
  await signInWithMockedVerifyData(page, request)
  await page.setViewportSize({ width: 390, height: 844 })
  await openVerify(page)
  await expect(workspaceNav(page)).toBeVisible()

  const openDocument = page.getByRole('link', { name: 'Open document' })
  await expect(openDocument).toBeVisible()
  const box = await openDocument.boundingBox()
  expect(box, 'Open document has no box').not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(391)

  const widths = await documentWidths(page)
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth)
})
