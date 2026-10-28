import '@obiter/test-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  TRACKED_DECISION_MAX_IDS,
  type DocumentChangeWire,
} from '@obiter/contracts'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  openRibbonTab,
  selectBodyParagraph,
} from './docx-workspace-harness'
import { ReviewRibbon } from './ribbon-review'

const inserted: DocumentChangeWire = {
  id: 'chg_1',
  ooxmlId: '4',
  inlinePosition: null,
  elementName: 'ins',
  kind: 'insert',
  storyPartName: 'word/document.xml',
  paragraphId: 'p1',
  text: 'added words',
  author: 'Review Author',
  date: '2026-08-11T12:30:00.000Z',
}
const format: DocumentChangeWire = {
  id: 'chg_2',
  ooxmlId: '5',
  inlinePosition: null,
  elementName: 'rPrChange',
  kind: 'property',
  scope: 'run',
  storyPartName: 'word/document.xml',
  paragraphId: 'p1',
  runId: 'r1',
  text: '',
  author: 'Review Author',
}
const unsupportedMove: DocumentChangeWire = {
  id: 'chg_3',
  ooxmlId: '6',
  inlinePosition: null,
  elementName: 'moveFrom',
  kind: 'move',
  direction: 'from',
  storyPartName: 'word/document.xml',
  paragraphId: 'p1',
  text: 'stranded move',
  author: 'Review Author',
  undecidable: 'unsupported-move',
}
const unsupportedMoveReason =
  'This move cannot be decided here; it stays listed and unchanged in the document.'
const overCap: DocumentChangeWire[] = Array.from(
  { length: TRACKED_DECISION_MAX_IDS + 1 },
  (_, index) => ({ ...inserted, id: `chg_bulk_${index}` }),
)

function decided(
  input: unknown,
  callbacks?: {
    onSuccess?: (data: { versionId: string; versionNumber: number }) => void
  },
) {
  callbacks?.onSuccess?.({ versionId: 'ver_2', versionNumber: 2 })
  return Promise.resolve({ versionId: 'ver_2', versionNumber: 2 })
}

describe('DocxWorkspace change review', () => {
  it('navigates the list and reveals the active change', () => {
    mountWorkspace({ changes: [inserted, format] })
    openRibbonTab('Review')

    // No target yet: the single-change controls say so instead of guessing.
    expect(
      screen.getByRole('button', {
        name: 'Accept change: Go to a change first — use Previous, Next or the Changes list.',
      }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByRole('button', {
        name: 'Previous change: There is no earlier change.',
      }),
    ).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    // The reveal lands the caret on the change's paragraph.
    expect(screen.getByLabelText('Paragraph text')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Accept change' }),
    ).toHaveProperty('disabled', false)
    expect(
      screen.getByRole('button', {
        name: 'Previous change: There is no earlier change.',
      }),
    ).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    expect(
      screen.getByRole('button', {
        name: 'Next change: There is no later change.',
      }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByRole('button', { name: 'Previous change' }),
    ).toHaveProperty('disabled', false)
  })

  it('reveals a missing inline anchor at the paragraph end', () => {
    mountWorkspace({
      changes: [{ ...inserted, inlinePosition: { beforeRunId: 'missing' } }],
    })
    openRibbonTab('Review')
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    const field = screen.getByLabelText<HTMLTextAreaElement>('Paragraph text')
    expect(field.selectionStart).toBe(field.value.length)
    expect(field.selectionStart).toBeGreaterThan(0)
  })

  it('roves the canvas tab stop across painted revisions only', () => {
    const first = {
      ...inserted,
      id: 'ins_a',
      text: 'first',
      inlinePosition: { beforeRunId: 'p1-r' },
    }
    const second = {
      ...inserted,
      id: 'ins_b',
      text: 'second',
      inlinePosition: { beforeRunId: null },
    }
    const changes = [first, format, second]
    const { container } = mountWorkspace({
      changes,
      models: {
        doc_1: {
          ...multiParagraphModel([paragraph('p1', 'Hello')]),
          changes,
        },
      },
    })
    const stops = () =>
      [...container.querySelectorAll('[data-inline-change][tabindex="0"]')].map(
        (node) => node.getAttribute('data-inline-change'),
      )
    // Nothing active yet: the first painted revision holds the only stop.
    expect(stops()).toEqual(['ins_a'])
    const span = container.querySelector('[data-inline-change="ins_a"]')
    if (!(span instanceof HTMLElement)) throw new Error('Expected revision')
    span.focus()
    const rove = (key: string) => {
      fireEvent.keyDown(document.activeElement ?? span, { key })
      return document.activeElement?.getAttribute('data-inline-change')
    }
    // The property change between them has no canvas text, so it is skipped,
    // and focus follows the stop rather than landing in the caret's textarea.
    expect(rove('ArrowRight')).toBe('ins_b')
    expect(rove('ArrowLeft')).toBe('ins_a')
    expect(stops()).toEqual(['ins_a'])
  })

  it('dispatches a single accept against the current change', () => {
    const decide = vi.fn(decided)
    mountWorkspace({ changes: [inserted, format], decideAsync: decide })
    openRibbonTab('Review')
    fireEvent.click(screen.getByRole('button', { name: 'Next change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept change' }))

    expect(decide).toHaveBeenCalledWith(
      {
        baseVersionId: 'ver_1',
        action: 'accept',
        changeIds: ['chg_1'],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('dispatches every change id in one bulk decision', () => {
    const decide = vi.fn(decided)
    mountWorkspace({ changes: [inserted, format], decideAsync: decide })
    openRibbonTab('Review')
    fireEvent.click(screen.getByRole('button', { name: 'Accept all changes' }))

    expect(decide).toHaveBeenCalledWith(
      {
        baseVersionId: 'ver_1',
        action: 'accept',
        changeIds: ['chg_1', 'chg_2'],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('carries a pending toggle flip on a decision', () => {
    const decide = vi.fn(decided)
    mountWorkspace({ changes: [inserted], decideAsync: decide })
    openRibbonTab('Review')
    fireEvent.click(screen.getByRole('button', { name: 'Track changes off' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept all changes' }))

    // A pending flip is unsaved state the decision commits with the version,
    // so the request carries it; without one the field stays absent.
    expect(decide).toHaveBeenCalledWith(
      {
        baseVersionId: 'ver_1',
        action: 'accept',
        changeIds: ['chg_1'],
        trackRevisions: true,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('refuses a decision while unsaved edits exist', () => {
    const decide = vi.fn(decided)
    mountWorkspace({ changes: [inserted], decideAsync: decide })
    selectBodyParagraph()
    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Unsaved work' },
    })
    openRibbonTab('Review')

    const reason = 'Save or discard unsaved edits before deciding changes.'
    expect(
      screen.getByRole('button', { name: `Accept all changes: ${reason}` }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByRole('button', { name: `Accept change: ${reason}` }),
    ).toHaveProperty('disabled', true)
    fireEvent.click(
      screen.getByRole('button', { name: `Accept change: ${reason}` }),
    )
    expect(decide).not.toHaveBeenCalled()
  })

  it('names the save barrier ahead of the decision cap', () => {
    // Both conditions hold here: the supported set alone exceeds the cap, and
    // unsaved edits bar every decision. The barrier is the actionable reason.
    mountWorkspace({ changes: overCap })
    selectBodyParagraph()
    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Unsaved work' },
    })
    openRibbonTab('Review')

    const reason = 'Save or discard unsaved edits before deciding changes.'
    expect(
      screen.getByRole('button', { name: `Accept all changes: ${reason}` }),
    ).toHaveProperty('disabled', true)
  })

  it('names the cap when the supported set alone exceeds it', () => {
    mountWorkspace({ changes: overCap })
    openRibbonTab('Review')

    expect(
      screen.getByRole('button', {
        name: `Accept all changes: More than ${TRACKED_DECISION_MAX_IDS} supported changes must be decided in smaller groups.`,
      }),
    ).toHaveProperty('disabled', true)
  })

  it('names the absent review surface instead of a boundary reason', () => {
    render(
      <ReviewRibbon
        canEdit
        trackChanges={false}
        commentsOpen={false}
        changesOpen={false}
        commentCount={0}
        changeCount={0}
        onToggleComments={() => undefined}
        onToggleChanges={() => undefined}
        onToggleTrackChanges={() => undefined}
        onExportText={() => undefined}
      />,
    )

    const absent = 'Change review is not available for this document.'
    for (const label of [
      'Previous change',
      'Next change',
      'Accept change',
      'Reject change',
      'Accept all changes',
      'Reject all changes',
    ]) {
      expect(
        screen.getByRole('button', { name: `${label}: ${absent}` }),
      ).toHaveProperty('disabled', true)
    }
  })

  it('carries the undecidable reason onto the ribbon once the row is current', () => {
    const decide = vi.fn(decided)
    mountWorkspace({
      changes: [inserted, unsupportedMove],
      decideAsync: decide,
    })
    openRibbonTab('Review')
    fireEvent.click(screen.getByRole('button', { name: 'Changes (2)' }))
    const panel = screen.getByRole('complementary', {
      name: 'Changes and comments',
    })
    // The undecidable move is pinned above the list, so it is the first row.
    fireEvent.click(
      within(panel).getAllByRole('button', { name: 'Show this change' })[0]!,
    )

    expect(
      screen.getByRole('button', {
        name: `Accept change: ${unsupportedMoveReason}`,
      }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByRole('button', {
        name: `Reject change: ${unsupportedMoveReason}`,
      }),
    ).toHaveProperty('disabled', true)
    expect(decide).not.toHaveBeenCalled()
  })

  it('rejects a lone insertion with its empty shell in the same decision', () => {
    const decide = vi.fn(decided)
    mountWorkspace({
      // The stored paragraph is empty because all its content is the pending
      // insertion — rejecting the change must remove the shell with it.
      models: {
        doc_1: {
          version: 1,
          stories: [
            {
              partName: 'word/document.xml',
              kind: 'document',
              paragraphs: [{ id: 'p1', runs: [], preservedXmlFragments: [] }],
              preservedXmlFragments: [],
              fields: [],
              unanchoredFieldParagraphIds: [],
            },
          ],
          styles: [],
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
      },
      changes: [inserted],
      decideAsync: decide,
    })
    openRibbonTab('Review')
    fireEvent.click(screen.getByRole('button', { name: 'Reject all changes' }))

    expect(decide).toHaveBeenCalledWith(
      {
        baseVersionId: 'ver_1',
        action: 'reject',
        changeIds: ['chg_1'],
        removeParagraphIds: ['p1'],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('scopes the ribbon bulk decision to the supported changes', () => {
    const decide = vi.fn(decided)
    mountWorkspace({
      changes: [inserted, format, unsupportedMove],
      decideAsync: decide,
    })
    openRibbonTab('Review')
    fireEvent.click(
      screen.getByRole('button', { name: 'Accept all supported changes' }),
    )

    // The undecidable change is never put on the wire — the request is one
    // atomic decision over the supported ids only.
    expect(decide).toHaveBeenCalledWith(
      {
        baseVersionId: 'ver_1',
        action: 'accept',
        changeIds: ['chg_1', 'chg_2'],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('disables bulk actions when nothing listed can be decided', () => {
    const decide = vi.fn(decided)
    mountWorkspace({ changes: [unsupportedMove], decideAsync: decide })
    openRibbonTab('Review')

    const reason =
      'None of the listed changes can be decided here; they stay listed and unchanged in the document.'
    expect(
      screen.getByRole('button', {
        name: `Accept all supported changes: ${reason}`,
      }),
    ).toHaveProperty('disabled', true)
    fireEvent.click(
      screen.getByRole('button', {
        name: `Accept all supported changes: ${reason}`,
      }),
    )
    expect(decide).not.toHaveBeenCalled()
  })

  it('reports an empty review honestly', () => {
    mountWorkspace({})
    openRibbonTab('Review')
    expect(
      screen.getByRole('button', {
        name: 'Accept change: There are no tracked changes.',
      }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByRole('button', {
        name: 'Accept all changes: There are no tracked changes.',
      }),
    ).toHaveProperty('disabled', true)
  })
})
