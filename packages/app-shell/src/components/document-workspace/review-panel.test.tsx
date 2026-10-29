import '@obiter/test-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentChangeWire, DocumentComment } from '@obiter/contracts'
import {
  commandDisabled,
  menuItem,
  openRibbonTab,
} from './editor-test-commands'
import {
  mountWorkspace,
  selectBodyParagraph,
  staleConflict,
  command,
} from './docx-workspace-harness'

const inserted: DocumentChangeWire = {
  id: 'chg_1',
  inlinePosition: null,
  elementName: 'ins',
  kind: 'insert',
  storyPartName: 'word/document.xml',
  paragraphId: 'p1',
  text: 'added words',
  author: 'Review Author',
  date: '2026-08-11T12:30:00.000Z',
}
const deleted: DocumentChangeWire = {
  id: 'chg_2',
  inlinePosition: null,
  elementName: 'del',
  kind: 'delete',
  storyPartName: 'word/document.xml',
  paragraphId: 'p1',
  text: 'removed words',
  author: 'Review Author',
  date: '2026-08-11T12:31:00.000Z',
}
const strayMove: DocumentChangeWire = {
  id: 'chg_move',
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
const pairedFrom: DocumentChangeWire = {
  id: 'chg_from',
  pairId: 'chg_to',
  inlinePosition: null,
  elementName: 'moveFrom',
  kind: 'move',
  direction: 'from',
  storyPartName: 'word/document.xml',
  paragraphId: 'p1',
  text: 'clause 18.2 wording',
  author: 'Other Side',
  date: '2026-08-12T09:00:00.000Z',
}
const pairedTo: DocumentChangeWire = {
  id: 'chg_to',
  pairId: 'chg_from',
  inlinePosition: null,
  elementName: 'moveTo',
  kind: 'move',
  direction: 'to',
  storyPartName: 'word/document.xml',
  paragraphId: 'p1',
  text: 'clause 18.2 wording',
  author: 'Other Side',
  date: '2026-08-12T09:00:00.000Z',
}

const comment: DocumentComment = {
  id: 'cmt_1',
  documentId: 'doc_1',
  anchorVersionId: 'ver_1',
  anchor: { paragraphId: 'p1', startOffset: 0, endOffset: 1 },
  body: 'Check this wording',
  author: { id: 'usr_1', name: 'Lex' },
  resolvedAt: null,
  resolvedBy: null,
  createdAt: '2026-08-11T00:00:00Z',
  updatedAt: '2026-08-11T00:00:00Z',
  replies: [],
  anchorResolved: true,
}

const moveNote =
  'This move cannot be decided here; it stays listed and unchanged in the document.'

function openReviewPanel() {
  openRibbonTab('Review')
  fireEvent.click(menuItem(/^Changes/))
  fireEvent.keyDown(document, { key: 'Escape' })
  return screen.getByRole('complementary', { name: 'Changes and comments' })
}

function row(panel: HTMLElement, text: string) {
  const found = within(panel)
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(text))
  if (!found) throw new Error(`No row for ${text}`)
  return found
}

function decided() {
  return Promise.resolve({ versionId: 'ver_2', versionNumber: 2 })
}

describe('review panel', () => {
  it('counts changes, comments and moves apart and never offers a comment a decision', () => {
    mountWorkspace({
      changes: [inserted, deleted, strayMove],
      comments: { comments: [comment] },
    })
    const panel = openReviewPanel()

    expect(panel.textContent).toContain('2 changes · 1 move · 1 comment')
    expect(panel.textContent).toContain(moveNote)
    const checkboxLabels = within(panel)
      .getAllByRole('checkbox')
      .map((box) => box.getAttribute('aria-label'))
    expect(checkboxLabels).toEqual([
      'Select the insertion by Review Author',
      'Select the deletion by Review Author',
    ])
    const moveRow = row(panel, 'stranded move')
    expect(moveRow.textContent).toContain("Move · can't be paired")
    expect(within(moveRow).queryByRole('checkbox')).toBeNull()
  })

  it('shows a paired move as one row and decides both halves together', () => {
    const decide = vi.fn(decided)
    mountWorkspace({
      changes: [pairedFrom, pairedTo, inserted],
      decideAsync: decide,
    })
    const panel = openReviewPanel()

    expect(panel.textContent).toContain('1 change · 1 move')
    expect(within(panel).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(
      within(row(panel, 'clause 18.2 wording')).getByRole('button', {
        name: 'Accept',
      }),
    )

    expect(decide).toHaveBeenCalledWith(
      {
        baseVersionId: 'ver_1',
        action: 'accept',
        changeIds: ['chg_from'],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('scopes a bulk decision to the selected changes and states the count', () => {
    const decide = vi.fn(decided)
    mountWorkspace({
      changes: [inserted, deleted, strayMove],
      decideAsync: decide,
    })
    const panel = openReviewPanel()

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select the insertion by Review Author',
      }),
    )
    expect(within(panel).getByText('1 change selected')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select the deletion by Review Author',
      }),
    )
    expect(within(panel).getByText('2 changes selected')).toBeTruthy()

    fireEvent.click(
      within(panel).getByRole('button', { name: 'Accept 2 changes' }),
    )
    expect(decide).toHaveBeenCalledWith(
      {
        baseVersionId: 'ver_1',
        action: 'accept',
        changeIds: ['chg_1', 'chg_2'],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('asks before rejecting a selection and names how many changes it affects', () => {
    const decide = vi.fn(decided)
    mountWorkspace({ changes: [inserted, deleted], decideAsync: decide })
    const panel = openReviewPanel()

    for (const box of within(panel).getAllByRole('checkbox')) {
      fireEvent.click(box)
    }
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Reject 2 changes' }),
    )

    expect(decide).not.toHaveBeenCalled()
    const confirm = within(panel).getByRole('alert')
    expect(confirm.textContent).toContain(
      'Reject 2 changes? This saves version 2. Version 1 stays available.',
    )
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Reject 2 changes' }),
    )
    expect(decide).toHaveBeenCalledWith(
      {
        baseVersionId: 'ver_1',
        action: 'reject',
        changeIds: ['chg_1', 'chg_2'],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('cancels a rejection without deciding anything', () => {
    const decide = vi.fn(decided)
    mountWorkspace({ changes: [inserted], decideAsync: decide })
    const panel = openReviewPanel()

    fireEvent.click(within(panel).getByRole('checkbox'))
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Reject 1 change' }),
    )
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))

    expect(decide).not.toHaveBeenCalled()
    expect(within(panel).queryByRole('alert')).toBeNull()
    expect(within(panel).getByText('1 change selected')).toBeTruthy()
  })

  it('clears the selection when a filter would hide a selected row', () => {
    mountWorkspace({ changes: [inserted, strayMove] })
    const panel = openReviewPanel()

    fireEvent.click(within(panel).getByRole('checkbox'))
    expect(within(panel).getByText('1 change selected')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Moves 1' }))

    expect(within(panel).queryByText(/^\d+ changes? selected$/)).toBeNull()
    expect(
      within(panel).queryByRole('button', { name: 'Accept 1 change' }),
    ).toBeNull()
  })

  it('reports a decision that did not save', () => {
    mountWorkspace({
      changes: [inserted],
      decideError: new Error('The request could not be saved.'),
    })
    const panel = openReviewPanel()

    expect(within(panel).getByRole('alert').textContent).toContain(
      "Your decision wasn't saved. Try again.",
    )
  })

  it('says the document is stale when a decision conflicts with the server', async () => {
    const decide = vi.fn(
      (_input: unknown, callbacks?: { onError?: (error: Error) => void }) =>
        callbacks?.onError?.(staleConflict),
    )
    mountWorkspace({ changes: [inserted], decideAsync: decide })
    const panel = openReviewPanel()

    fireEvent.click(
      within(row(panel, 'added words')).getByRole('button', { name: 'Accept' }),
    )

    await waitFor(() =>
      expect(
        within(row(panel, 'added words'))
          .getByRole('button', { name: 'Accept' })
          .getAttribute('title'),
      ).toBe('Reload before deciding changes.'),
    )
    expect(command('Reload')).toBeTruthy()
    for (const accept of within(panel).getAllByRole('button', {
      name: 'Accept',
    })) {
      expect(commandDisabled(accept)).toBe(true)
    }
  })

  it('names the save barrier on the row and in the decision bar', () => {
    mountWorkspace({ changes: [inserted] })
    selectBodyParagraph()
    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Unsaved work' },
    })
    const panel = openReviewPanel()

    const reason = 'Save or discard unsaved edits before deciding changes.'
    const accept = within(row(panel, 'added words')).getByRole('button', {
      name: 'Accept',
    })
    expect(accept.getAttribute('title')).toBe(reason)
    fireEvent.click(
      within(row(panel, 'added words')).getByRole('button', {
        name: 'Show this change',
      }),
    )
    const barButtons = within(panel).getAllByRole('button', {
      name: 'Accept',
    })
    expect(barButtons.at(-1)?.getAttribute('title')).toBe(reason)
  })

  it('follows the row under review with the decision bar and its own navigation', () => {
    mountWorkspace({ changes: [inserted, deleted] })
    const panel = openReviewPanel()

    expect(panel.textContent).toContain('0 of 2')
    expect(
      within(panel).getByRole('button', { name: 'Previous' }),
    ).toHaveProperty('disabled', true)

    fireEvent.click(
      within(panel).getAllByRole('button', {
        name: 'Show this change',
      })[1] as HTMLElement,
    )
    expect(panel.textContent).toContain('2 of 2')

    const previous = within(panel).getByRole('button', { name: 'Previous' })
    fireEvent.click(previous)
    expect(panel.textContent).toContain('1 of 2')
    expect(within(panel).getByRole('button', { name: 'Next' })).toHaveProperty(
      'disabled',
      false,
    )
  })
})
