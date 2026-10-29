import '@obiter/test-dom'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  TRACKED_DECISION_MAX_IDS,
  type DocumentChangeWire,
} from '@obiter/contracts'
import {
  command,
  commandDisabled,
  commandReason,
  openRibbonTab,
} from './editor-test-commands'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  selectBodyParagraph,
} from './docx-workspace-harness'

import { editorMenus } from './editor-commands'

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
    fireEvent.click(command('Changes (2)'))
    const panel = screen.getByRole('complementary', {
      name: 'Changes and comments',
    })
    const next = () => within(panel).getByRole('button', { name: /^Next/ })
    const previous = () =>
      within(panel).getByRole('button', { name: /^Previous/ })

    expect(panel.textContent).toContain('No change selected')
    expect(previous()).toHaveProperty('disabled', true)

    fireEvent.click(next())
    expect(screen.getByLabelText('Paragraph text')).toBeTruthy()
    expect(panel.textContent).toContain('1 of 2')
    expect(previous()).toHaveProperty('disabled', true)

    fireEvent.click(next())
    expect(panel.textContent).toContain('2 of 2')
    expect(next()).toHaveProperty('disabled', true)
    expect(previous()).toHaveProperty('disabled', false)
  })

  it('reveals a missing inline anchor at the paragraph end', () => {
    mountWorkspace({
      changes: [{ ...inserted, inlinePosition: { beforeRunId: 'missing' } }],
    })
    openRibbonTab('Review')
    fireEvent.click(command('Next change'))
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
    expect(stops()).toEqual(['ins_a'])
    const span = container.querySelector('[data-inline-change="ins_a"]')
    if (!(span instanceof HTMLElement)) throw new Error('Expected revision')
    span.focus()
    const rove = (key: string) => {
      fireEvent.keyDown(document.activeElement ?? span, { key })
      return document.activeElement?.getAttribute('data-inline-change')
    }
    expect(rove('ArrowRight')).toBe('ins_b')
    expect(rove('ArrowLeft')).toBe('ins_a')
    expect(stops()).toEqual(['ins_a'])
  })

  it('dispatches a single accept against the current change', () => {
    const decide = vi.fn(decided)
    mountWorkspace({ changes: [inserted, format], decideAsync: decide })
    openRibbonTab('Review')
    fireEvent.click(command('Next change'))
    fireEvent.click(command('Accept change'))

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
    fireEvent.click(command('Accept all changes'))

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
    fireEvent.click(screen.getByRole('switch', { name: 'Track changes' }))
    fireEvent.click(command('Accept all changes'))

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
    const acceptAll = command('Accept all changes')
    expect(commandDisabled(acceptAll)).toBe(true)
    expect(commandReason(acceptAll)).toBe(reason)
    const accept = command('Accept change')
    expect(commandDisabled(accept)).toBe(true)
    expect(commandReason(accept)).toBe(reason)
    fireEvent.click(accept)
    expect(decide).not.toHaveBeenCalled()
  })

  it('names the save barrier ahead of the decision cap', () => {
    mountWorkspace({ changes: overCap })
    selectBodyParagraph()
    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Unsaved work' },
    })
    openRibbonTab('Review')

    const reason = 'Save or discard unsaved edits before deciding changes.'
    const acceptAll = command('Accept all changes')
    expect(commandDisabled(acceptAll)).toBe(true)
    expect(commandReason(acceptAll)).toBe(reason)
  })

  it('names the cap when the supported set alone exceeds it', () => {
    mountWorkspace({ changes: overCap })
    openRibbonTab('Review')

    const acceptAll = command('Accept all changes')
    expect(commandDisabled(acceptAll)).toBe(true)
    expect(commandReason(acceptAll)).toBe(
      `More than ${TRACKED_DECISION_MAX_IDS} supported changes must be decided in smaller groups.`,
    )
  })

  it('names the absent review surface instead of a boundary reason', () => {
    const absent = 'Change review is not available for this document.'
    const menus = editorMenus(
      {
        canEdit: false,
        trackChanges: false,
        zoom: 100,
        commentsOpen: false,
        changesOpen: false,
        authoritiesOpen: false,
        infoOpen: false,
        commentCount: 0,
        changeCount: 0,
        onToggleComments: () => undefined,
        onToggleChanges: () => undefined,
        onToggleAuthorities: () => undefined,
        onInsertAuthorityText: () => undefined,
        canInsertAuthority: true,
        citationStyle: 'oscola',
        onToggleTrackChanges: () => undefined,
        onZoom: () => undefined,
        onExportText: () => undefined,
        onExportShareSafe: () => undefined,
        onPrint: () => undefined,
        onUndo: () => undefined,
        onRedo: () => undefined,
        onInsertParagraph: () => undefined,
        onDeleteParagraph: () => undefined,
        onSave: () => undefined,
        canSave: false,
        onPageBreak: () => undefined,
        onSectionBreak: () => undefined,
        structure: {
          crossReferenceTargets: [],
          onOpenStory: () => undefined,
          onCloseStory: () => undefined,
          onInsertTable: () => undefined,
          onInsertLink: () => ({
            inserted: false,
            reason: 'not available',
          }),
          onInsertCrossReference: () => ({
            inserted: false,
            reason: 'not available',
          }),
          onMarkDefinedTerm: () => undefined,
          onInsertPageNumber: () => undefined,
          onInsertTableOfContents: () => undefined,
          onInsertTableOfAuthorities: () => undefined,
          onUpdateTableOfAuthorities: () => undefined,
          onInsertFootnote: () => undefined,
          onInsertPicture: () => undefined,
          picturePicker: null,
        },
        view: 'print',
        onView: () => undefined,
        rulerOn: false,
        onToggleRuler: () => undefined,
        navOpen: false,
        onToggleNavPane: () => undefined,
        spelling: false,
        onToggleSpelling: () => undefined,
      },
      {
        openFormatting: () => undefined,
        openFind: () => undefined,
        openPalette: () => undefined,
        openTable: () => undefined,
        openLink: () => undefined,
        openCrossReference: () => undefined,
        openAuthority: () => undefined,
        closeStory: () => undefined,
      },
    )
    const rows = menus
      .flatMap((menu) => menu.groups)
      .flatMap((group) => group.commands)
    for (const label of [
      'Previous change',
      'Next change',
      'Accept change',
      'Reject change',
      'Accept all changes',
      'Reject all changes',
    ]) {
      const row = rows.find((command) => command.label === label)
      expect(row?.disabled).toBe(true)
      expect(row?.disabledReason).toBe(absent)
    }
  })

  it('carries the undecidable reason onto the ribbon once the row is current', () => {
    const decide = vi.fn(decided)
    mountWorkspace({
      changes: [inserted, unsupportedMove],
      decideAsync: decide,
    })
    openRibbonTab('Review')
    fireEvent.click(command('Changes (2)'))
    const panel = screen.getByRole('complementary', {
      name: 'Changes and comments',
    })
    fireEvent.click(
      within(panel).getAllByRole('button', { name: 'Show this change' })[0]!,
    )

    for (const accept of within(panel).getAllByRole('button', {
      name: 'Accept',
    })) {
      if (accept.closest('li')?.textContent?.includes('cannot be paired'))
        expect(accept).toHaveProperty('disabled', true)
    }
    expect(
      within(panel).getAllByText(unsupportedMoveReason).length,
    ).toBeGreaterThan(0)
    expect(decide).not.toHaveBeenCalled()
  })

  it('rejects a lone insertion with its empty shell in the same decision', () => {
    const decide = vi.fn(decided)
    mountWorkspace({
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
    fireEvent.click(command('Reject all changes'))

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
    fireEvent.click(command('Accept all supported changes'))

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
    const acceptAll = command('Accept all supported changes')
    expect(commandDisabled(acceptAll)).toBe(true)
    expect(commandReason(acceptAll)).toBe(reason)
    fireEvent.click(acceptAll)
    expect(decide).not.toHaveBeenCalled()
  })

  it('reports an empty review honestly', () => {
    mountWorkspace({})
    openRibbonTab('Review')
    const accept = command('Accept change')
    expect(commandDisabled(accept)).toBe(true)
    expect(commandReason(accept)).toBe('There are no tracked changes.')
    const acceptAll = command('Accept all changes')
    expect(commandDisabled(acceptAll)).toBe(true)
    expect(commandReason(acceptAll)).toBe('There are no tracked changes.')
  })
})
