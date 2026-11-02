import { test, expect } from '@playwright/test'
import type { RedactionRun } from '@obiter/redact-ui'
import { mockSession } from './shell-harness'

const initialRun: RedactionRun = {
  id: 'red_cache',
  matterId: null,
  matterName: null,
  documentId: null,
  documentVersionId: null,
  sourceFilename: 'synthetic-cache.txt',
  sourcePreview: { kind: 'text', available: false },
  status: 'ready_for_review',
  policyMode: 'internal_ai_minimisation',
  spans: [
    {
      id: 'span_1',
      start: 0,
      end: 4,
      text: 'Jane',
      category: 'person_name',
      source: 'rampart_model',
      confidence: 'high',
      suggestion: 'redact',
    },
  ],
  decisions: {},
  outputId: null,
  detectorVersion: null,
  detectionMode: 'model+supplement',
  replacesRunId: null,
  replacementRunId: null,
  returnedDocumentVersionId: null,
  summary: {
    totalSpans: 1,
    byCategory: {
      person_name: 1,
      address: 0,
      date: 0,
      email: 0,
      phone: 0,
      account_number: 0,
      government_id: 0,
      national_insurance: 0,
      organisation_name: 0,
      case_reference: 0,
      url: 0,
      secret: 0,
      passport: 0,
      ip_address: 0,
      drivers_license: 0,
    },
    bySource: { rampartModel: 1, rampartDeterministic: 0, ukSupplement: 0 },
    reviewedCount: 0,
    unreviewedCount: 1,
  },
  createdAt: '2026-10-26T14:00:00.000Z',
  updatedAt: '2026-10-26T14:00:00.000Z',
}

test('a span decision refreshes the prefetched run list before returning to Redact', async ({
  page,
}) => {
  await mockSession(page)
  let run = initialRun
  await page.route('**/api/redaction-runs', (route) =>
    route.fulfill({ json: { runs: [run] } }),
  )
  await page.route('**/api/redaction-runs/red_cache', (route) =>
    route.fulfill({ json: { run } }),
  )
  await page.route('**/api/redaction-runs/red_cache/document-text', (route) =>
    route.fulfill({ json: { text: 'Jane filed.' } }),
  )
  await page.route(
    '**/api/redaction-runs/red_cache/spans/span_1/decision',
    (route) => {
      run = {
        ...run,
        status: 'reviewing',
        decisions: {
          span_1: {
            decision: 'accept',
            decidedBy: 'usr_shell_test',
            decidedAt: '2026-11-02T00:00:00.000Z',
          },
        },
        summary: { ...run.summary, reviewedCount: 1, unreviewedCount: 0 },
      }
      return route.fulfill({ json: { run } })
    },
  )
  await page.goto('/search')
  const navigation = page.getByRole('navigation', { name: 'Workspace' })
  await navigation.getByRole('link', { name: /Redact/ }).click()
  await expect(page.getByText('0 of 1 decided', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const spans = page.getByRole('listbox', { name: 'Detected spans' })
  await spans.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('tab', { name: 'Unreviewed 0', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('link', { name: /Redact/ })
    .click()
  await expect(page.getByText('1 of 1 decided', { exact: true })).toBeVisible()
})
