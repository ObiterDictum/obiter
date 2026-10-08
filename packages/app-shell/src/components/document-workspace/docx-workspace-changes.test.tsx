import '@obiter/test-dom'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentChangeWire } from '@obiter/contracts'
import {
  mountWorkspace,
  openRibbonTab,
  selectBodyParagraph,
} from './docx-workspace-harness'

const inserted: DocumentChangeWire = {
  id: 'chg_1',
  ooxmlId: '4',
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

  it('lists changes, reveals one on click, and decides it', () => {
    const decide = vi.fn(decided)
    mountWorkspace({ changes: [inserted, format], decideAsync: decide })
    openRibbonTab('Review')
    fireEvent.click(screen.getByRole('button', { name: 'Changes (2)' }))

    const panel = screen.getByRole('complementary', {
      name: 'Tracked changes',
    })
    expect(panel.textContent).toContain('— of 2')

    const items = within(panel).getAllByRole('button', {
      name: 'Show this change',
    })
    fireEvent.click(items[1]!)
    expect(panel.textContent).toContain('2 of 2')
    expect(items[1]!.closest('li')?.getAttribute('aria-current')).toBe('true')
    expect(items[0]!.closest('li')?.getAttribute('aria-current')).toBeNull()

    const item = items[1]!.closest('li')
    if (!item) throw new Error('Change item is missing.')
    fireEvent.click(within(item).getByRole('button', { name: 'Accept' }))
    expect(decide).toHaveBeenCalledWith(
      {
        baseVersionId: 'ver_1',
        action: 'accept',
        changeIds: ['chg_2'],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
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
            },
          ],
          styles: [],
          numbering: [],
          relationships: [],
          preservedXmlFragments: [],
          changes: [],
          comments: [],
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

  it('marks an undecidable change, disables only its controls, and still navigates', () => {
    const decide = vi.fn(decided)
    mountWorkspace({
      changes: [inserted, unsupportedMove],
      decideAsync: decide,
    })
    openRibbonTab('Review')
    fireEvent.click(screen.getByRole('button', { name: 'Changes (2)' }))

    const panel = screen.getByRole('complementary', {
      name: 'Tracked changes',
    })
    expect(panel.textContent).toContain(unsupportedMoveReason)
    expect(panel.textContent).toContain(
      'One listed change cannot be decided here',
    )
    const items = within(panel).getAllByRole('button', {
      name: 'Show this change',
    })
    const item = items[1]?.closest('li')
    if (!item) throw new Error('Undecidable change row is missing.')
    expect(within(item).getByRole('button', { name: 'Accept' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(within(item).getByRole('button', { name: 'Reject' })).toHaveProperty(
      'disabled',
      true,
    )

    // The row still reveals its location, and the ribbon's single-change
    // controls carry the reason on their accessible name once it is active.
    fireEvent.click(items[1]!)
    expect(item.getAttribute('aria-current')).toBe('true')
    expect(
      screen.getByRole('button', {
        name: `Accept change: ${unsupportedMoveReason}`,
      }),
    ).toHaveProperty('disabled', true)
    fireEvent.click(
      screen.getByRole('button', {
        name: `Accept change: ${unsupportedMoveReason}`,
      }),
    )
    expect(decide).not.toHaveBeenCalled()
  })

  it('scopes a bulk decision to the supported changes and says so', () => {
    const decide = vi.fn(decided)
    mountWorkspace({
      changes: [inserted, format, unsupportedMove],
      decideAsync: decide,
    })
    openRibbonTab('Review')

    const panel = (() => {
      fireEvent.click(screen.getByRole('button', { name: 'Changes (3)' }))
      return screen.getByRole('complementary', { name: 'Tracked changes' })
    })()
    expect(panel.textContent).toContain(
      'One listed change cannot be decided here',
    )
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
