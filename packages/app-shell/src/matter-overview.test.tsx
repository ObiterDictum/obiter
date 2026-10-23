import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { verificationRunListResponseSchema } from '@obiter/contracts'
import type { MatterDocumentRecord } from './documents'
import type { MatterRecord } from './matters'
import { MatterOverview } from './views/matter-overview'

const at = '2026-10-01T09:00:00.000Z'

const matter: MatterRecord = {
  id: 'mtr_1',
  organisationId: 'org_1',
  name: 'Share purchase',
  description: null,
  primaryJurisdiction: 'England & Wales',
  secondaryJurisdictions: [],
  legalDomains: ['Corporate'],
  clientReference: 'REF-1',
  status: 'active',
  createdBy: 'usr_1',
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  deletedBy: null,
}

function document(id: string, filename: string): MatterDocumentRecord {
  return {
    id,
    organisationId: 'org_1',
    matterId: 'mtr_1',
    currentVersionId: `ver_${id}`,
    logicalKey: filename,
    createdBy: 'usr_1',
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    deletedBy: null,
    currentVersion: {
      id: `ver_${id}`,
      organisationId: 'org_1',
      matterId: 'mtr_1',
      matterDocumentId: id,
      filename,
      fileType: 'docx',
      sizeBytes: '1024',
      objectKey: `org/org_1/matters/mtr_1/documents/${id}/versions/1/source`,
      textObjectKey: null,
      documentStatus: 'ready',
      failureReason: null,
      versionNumber: 2,
      contentSha256: 'a'.repeat(64),
      syncState: 'synced',
      createdBy: 'usr_1',
      createdAt: at,
      updatedAt: at,
    },
  }
}

// Parsed through the shared contract so the fixture is the API's wire shape.
const verifiedRuns = verificationRunListResponseSchema.parse({
  runs: [
    {
      id: 'vrun_1',
      organisationId: 'org_1',
      matterId: 'mtr_1',
      documentId: 'doc_1',
      documentVersionId: 'ver_doc_1',
      status: 'completed',
      failureCode: null,
      createdBy: 'usr_1',
      createdAt: at,
      startedAt: at,
      completedAt: at,
      summary: { findingCount: 5, flaggedCount: 2, reviewRequiredCount: 1 },
      documentCurrentVersionId: 'ver_doc_1',
      stale: false,
    },
  ],
  nextCursor: null,
})

const responses: Record<string, unknown> = {
  '/api/documents/doc_1/verification-runs': verifiedRuns,
  '/api/documents/doc_2/verification-runs': { runs: [], nextCursor: null },
  '/api/redaction-runs': {
    runs: [
      {
        id: 'rrun_1',
        sourceFilename: 'witness-statement.docx',
        status: 'ready_for_review',
        matterId: 'mtr_1',
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'rrun_2',
        sourceFilename: 'other-matter.docx',
        status: 'finalized',
        matterId: 'mtr_2',
        createdAt: at,
        updatedAt: at,
      },
    ],
  },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MatterOverview', () => {
  it('shows each document’s Verify status from its latest run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), 'http://localhost').pathname
        const body = responses[path]
        return body
          ? Response.json(body)
          : Response.json({ error: 'not found' }, { status: 404 })
      }),
    )
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => (
          <MatterOverview
            matter={matter}
            documents={{
              data: [
                document('doc_1', 'heads-of-terms.docx'),
                document('doc_2', 'disclosure-letter.docx'),
              ],
              isLoading: false,
              isError: false,
            }}
          />
        ),
      }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    const verified = await screen.findByRole('link', {
      name: /heads-of-terms\.docx/,
    })
    expect(
      await within(verified).findByText('2 flagged · 1 need review'),
    ).toBeTruthy()
    expect(verified.getAttribute('href')).toBe('/matters/mtr_1/documents/doc_1')
    const unverified = screen.getByRole('link', {
      name: /disclosure-letter\.docx/,
    })
    expect(await within(unverified).findByText('Not verified')).toBeTruthy()

    const run = await screen.findByRole('link', {
      name: /witness-statement\.docx/,
    })
    expect(within(run).getByText('Ready for review')).toBeTruthy()
    expect(screen.queryByText('other-matter.docx')).toBeNull()
  })
})
