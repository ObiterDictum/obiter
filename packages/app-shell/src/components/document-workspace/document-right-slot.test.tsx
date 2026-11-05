import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocumentComment } from '@obiter/contracts'
import { ApiError } from '../../api'
import type {
  DocumentVersionRecord,
  MatterDocumentRecord,
} from '../../documents'
import {
  DocumentChecksTab,
  DocumentCommentsTab,
  DocumentTabsNotice,
} from './document-right-slot'
import { DocumentHistoryTab } from './document-history-tab'
import type { WorkspaceCommentsPanelProps } from './use-workspace-comments'

afterEach(() => cleanup())

const noChecks = {
  references: { fields: 0, pending: 0, findings: [] },
  terms: { terms: [], findings: [] },
}

describe('Checks tab', () => {
  it('says the checks are waiting for the document while it loads', () => {
    render(
      <DocumentChecksTab
        state={{ status: 'loading' }}
        authorities={[]}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain(
      'Loading the document to check it',
    )
  })

  it('names the failure when the document model could not be loaded', () => {
    render(
      <DocumentChecksTab
        state={{
          status: 'error',
          error: new ApiError(
            'document_not_found',
            'The model is unavailable.',
            404,
            'req_1',
          ),
        }}
        authorities={[]}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('Checks could not run')).toBeTruthy()
    expect(screen.getByText('The model is unavailable.')).toBeTruthy()
  })

  it('shows one empty state when no check has anything to report', () => {
    render(
      <DocumentChecksTab
        state={{ status: 'ready', checks: noChecks }}
        authorities={[]}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('No findings')).toBeTruthy()
    expect(screen.queryByText('Defined terms')).toBeNull()
  })

  it('groups results by check and jumps to the paragraph a finding names', () => {
    const onSelect = vi.fn()
    render(
      <DocumentChecksTab
        state={{
          status: 'ready',
          checks: {
            references: {
              fields: 2,
              pending: 0,
              findings: [
                {
                  id: 'xref-1',
                  paragraphId: 'p7',
                  pending: false,
                  severity: 'issue',
                  message: 'Clause 4.2 points at a heading that was deleted.',
                },
              ],
            },
            terms: {
              terms: [
                { term: 'Premises', marks: 1, uses: 3, paragraphId: 'p1' },
              ],
              findings: [
                {
                  id: 'term-1',
                  paragraphId: 'p3',
                  pending: false,
                  severity: 'review',
                  message: '"Landlord" is used but never defined.',
                },
              ],
            },
          },
        }}
        authorities={[
          { paragraphId: 'p9', start: 0, end: 16, citation: '[2017] UKSC 24' },
        ]}
        onSelect={onSelect}
      />,
    )
    expect(
      screen.getAllByRole('heading').map((heading) => heading.textContent),
    ).toEqual(['Defined terms', 'Cross-references', 'Authorities'])
    fireEvent.click(screen.getByRole('button', { name: /never defined/ }))
    expect(onSelect).toHaveBeenLastCalledWith('p3')
    fireEvent.click(screen.getByRole('button', { name: /heading that was/ }))
    expect(onSelect).toHaveBeenLastCalledWith('p7')
    fireEvent.click(screen.getByRole('button', { name: '[2017] UKSC 24' }))
    expect(onSelect).toHaveBeenLastCalledWith('p9')
  })
})

const comment: DocumentComment = {
  id: 'cmt_1',
  documentId: 'doc_1',
  anchorVersionId: 'ver_1',
  anchor: { paragraphId: 'p2', startOffset: 0, endOffset: 5 },
  body: 'Check the notice period against clause 9.',
  author: { id: 'usr_2', name: 'Priya Shah' },
  resolvedAt: null,
  resolvedBy: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  replies: [],
  anchorResolved: true,
}

function commentProps(
  overrides: Partial<WorkspaceCommentsPanelProps> = {},
): WorkspaceCommentsPanelProps {
  return {
    comments: [],
    importedComments: [],
    orphanedReplies: [],
    commentTarget: null,
    currentUserId: 'usr_1',
    canModerate: true,
    commentsPending: false,
    commentsError: null,
    onCreateComment: vi.fn(async () => true),
    onReplyComment: vi.fn(async () => true),
    onResolveComment: vi.fn(),
    onReopenComment: vi.fn(),
    onRevealCommentAnchor: vi.fn(),
    ...overrides,
  }
}

describe('Comments tab', () => {
  it('says the comments are loading', () => {
    render(
      <DocumentCommentsTab
        state={{ status: 'loading' }}
        comments={commentProps()}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Loading comments')
  })

  it('names the failure when the comments could not be loaded', () => {
    render(
      <DocumentCommentsTab
        state={{ status: 'error', error: new Error('offline') }}
        comments={commentProps()}
      />,
    )
    expect(screen.getByText('Comments could not be loaded')).toBeTruthy()
  })

  it('shows the empty state when the document has no comments', () => {
    render(
      <DocumentCommentsTab
        state={{ status: 'ready' }}
        comments={commentProps()}
      />,
    )
    expect(screen.getByText('No comments yet')).toBeTruthy()
  })

  it('lists threads, jumps to the anchor and resolves through the API hooks', () => {
    const props = commentProps({ comments: [comment] })
    render(<DocumentCommentsTab state={{ status: 'ready' }} comments={props} />)
    expect(
      screen.getByText('Check the notice period against clause 9.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Show in document/ }))
    expect(props.onRevealCommentAnchor).toHaveBeenCalledWith(comment.anchor)
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(props.onResolveComment).toHaveBeenCalledWith('cmt_1')
  })
})

function version(
  versionNumber: number,
  overrides: Partial<DocumentVersionRecord> = {},
): DocumentVersionRecord {
  return {
    id: `ver_${String(versionNumber)}`,
    organisationId: 'org_1',
    matterId: 'mtr_1',
    matterDocumentId: 'doc_1',
    filename: 'Lease.docx',
    fileType: 'docx',
    sizeBytes: '2048',
    objectKey: 'k',
    textObjectKey: null,
    documentStatus: 'ready',
    failureReason: null,
    versionNumber,
    contentSha256: 'sha',
    syncState: 'synced',
    createdBy: 'usr_1',
    author: { id: 'usr_1', name: 'Alex Morgan' },
    createdAt: `2026-11-0${String(versionNumber)}T09:00:00.000Z`,
    updatedAt: `2026-11-0${String(versionNumber)}T09:00:00.000Z`,
    ...overrides,
  }
}

const matterDocument: MatterDocumentRecord = {
  id: 'doc_1',
  organisationId: 'org_1',
  matterId: 'mtr_1',
  currentVersionId: 'ver_3',
  logicalKey: 'lease',
  createdBy: 'usr_1',
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-03T09:00:00.000Z',
  deletedAt: null,
  deletedBy: null,
}

describe('History tab', () => {
  it('says the versions are loading', () => {
    render(
      <DocumentHistoryTab
        state={{ status: 'loading' }}
        viewingVersionId={undefined}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Loading versions')
  })

  it('names the failure when the versions could not be loaded', () => {
    render(
      <DocumentHistoryTab
        state={{ status: 'error', error: new Error('offline') }}
        viewingVersionId={undefined}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('Versions could not be loaded')).toBeTruthy()
  })

  it('shows the empty state when no version has been saved', () => {
    render(
      <DocumentHistoryTab
        state={{ status: 'ready', document: matterDocument, versions: [] }}
        viewingVersionId={undefined}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('No saved versions')).toBeTruthy()
  })

  it('lists versions newest first with who saved them and when', () => {
    render(
      <DocumentHistoryTab
        state={{
          status: 'ready',
          document: matterDocument,
          versions: [version(1), version(2), version(3)],
        }}
        viewingVersionId={undefined}
        onSelect={vi.fn()}
      />,
    )
    const rows = screen.getAllByRole('button')
    expect(
      rows.map((row) => row.textContent?.match(/Version \d/)?.[0]),
    ).toEqual(['Version 3', 'Version 2', 'Version 1'])
    expect(rows[0]?.textContent).toContain('Current version')
    expect(rows[0]?.textContent).toContain('Alex Morgan')
    expect(rows[2]?.textContent).toContain('Original upload')
    expect(rows[0]?.getAttribute('aria-current')).toBe('true')
  })

  it('opens an earlier version read-only and returns to the current one', () => {
    const onSelect = vi.fn()
    const state = {
      status: 'ready' as const,
      document: matterDocument,
      versions: [version(1), version(2), version(3)],
    }
    const { rerender } = render(
      <DocumentHistoryTab
        state={state}
        viewingVersionId={undefined}
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Version 2/ }))
    expect(onSelect).toHaveBeenLastCalledWith('ver_2')
    rerender(
      <DocumentHistoryTab
        state={state}
        viewingVersionId="ver_2"
        onSelect={onSelect}
      />,
    )
    expect(
      screen
        .getByRole('button', { name: /Version 2/ })
        .getAttribute('aria-current'),
    ).toBe('true')
    expect(screen.getByText(/Viewing version 2 read only/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Version 3/ }))
    expect(onSelect).toHaveBeenLastCalledWith(undefined)
  })

  it('does not open a version that is still processing', () => {
    render(
      <DocumentHistoryTab
        state={{
          status: 'ready',
          document: { ...matterDocument, currentVersionId: 'ver_1' },
          versions: [version(1), version(2, { documentStatus: 'processing' })],
        }}
        viewingVersionId={undefined}
        onSelect={vi.fn()}
      />,
    )
    expect(
      screen
        .getByRole('button', { name: /Version 2/ })
        .hasAttribute('disabled'),
    ).toBe(true)
  })
})

describe('Comments and Checks notice', () => {
  it('offers a way back to the current version while an earlier one is open', () => {
    const onReturn = vi.fn()
    render(
      <DocumentTabsNotice
        notice={{ kind: 'historical', versionNumber: 2, onReturn }}
        tab="checks"
      />,
    )
    expect(screen.getByText('Viewing version 2')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to the current version' }),
    )
    expect(onReturn).toHaveBeenCalled()
  })

  it('explains that comments and checks need a Word document', () => {
    render(<DocumentTabsNotice notice={{ kind: 'not-word' }} tab="comments" />)
    expect(screen.getByText('Comments need a Word document')).toBeTruthy()
  })
})
