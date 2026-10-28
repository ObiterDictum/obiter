import '@obiter/test-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { ApiError } from '../../api'
import { openRibbonTab } from './editor-test-commands'
import {
  downloadBlob,
  fetchDocumentExport,
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  selectBodyParagraph,
  staleConflict,
  command,
  commandOrNull,
} from './docx-workspace-harness'


/** The authoritative lineage a text-only save returns: no structural slots. */
/**
 * A text-only save of `r1` in `p1`: the run keeps its result address, which
 * the workspace resolves the reversal through.
 */
function textEditLineage(baseVersionId: string, versionId: string) {
  return {
    version: 1 as const,
    baseVersionId,
    versionId,
    acceptedOperations: [0],
    paragraphs: [
      {
        fromParagraphId: 'p1',
        toParagraphId: 'p1',
        runs: [
          {
            runIndex: 0,
            // The two mounted fixtures address the same single run under
            // different ids (`r1` and `p1-r`).
            segments: [
              { fromRunId: 'r1', fromOffset: 0, toOffset: 0 },
              { fromRunId: 'p1-r', fromOffset: 0, toOffset: 0 },
            ],
          },
        ],
      },
    ],
  }
}

describe('DocxWorkspace chrome', () => {
  it('keeps the chrome outside the scrolling document desk', () => {
    mountWorkspace({})
    const desk = document.querySelector('[data-document-desk]')
    // The ribbon is gone: no tab strip, and none of the chrome is inside the
    // desk's scroll box, so scrolling the paper never scrolls the commands.
    expect(desk?.querySelector('[role="tab"]')).toBeNull()
    expect(document.querySelector('[role="tab"]')).toBeNull()
    const menu = screen.getByRole('navigation', { name: 'Document menu' })
    for (const name of ['File', 'Edit', 'Insert', 'Format', 'Review', 'View']) {
      expect(within(menu).getByRole('button', { name })).toBeTruthy()
    }
    expect(desk?.contains(menu)).toBe(false)
  })

  it('wires the font commands and keeps the rest unavailable', () => {
    mountWorkspace({})
    // The font values live in the formatting panel; opening it is the same
    // click the toolbar's own control makes.
    fireEvent.click(
      screen.getByRole('button', { name: 'Font, paragraph and page' }),
    )
    for (const name of ['Font', 'Font size', 'Font colour']) {
      expect(screen.getByRole('combobox', { name })).toHaveProperty(
        'disabled',
        false,
      )
    }
    expect(
      command('Clear formatting'),
    ).toHaveProperty('disabled', false)
    expect(
      screen.getByRole('combobox', { name: 'Line spacing' }),
    ).toHaveProperty('disabled', false)
    expect(command('Bullets')).toHaveProperty(
      'disabled',
      true,
    )
    expect(
      command('Multilevel numbering'),
    ).toHaveProperty('disabled', true)
    openRibbonTab('Insert')
    // Table and picture are real controls; with no caret paragraph they
    // report an honest reason instead of a placeholder label.
    expect(
      screen.getByRole('button', {
        name: 'Insert table: Place the cursor in a paragraph to insert',
      }),
    ).toHaveProperty('disabled', true)
    expect(
      screen.getByRole('button', {
        name: 'Picture: Place the cursor in a paragraph to insert',
      }),
    ).toHaveProperty('disabled', true)
    openRibbonTab('Layout')
    // The E12 classification controls are live: they commit immutable marking
    // versions against the saved document.
    expect(
      screen.getByRole('combobox', { name: 'Document type' }),
    ).toHaveProperty('disabled', false)
    expect(command('Privileged')).toHaveProperty(
      'disabled',
      false,
    )
    expect(command('Draft')).toHaveProperty(
      'disabled',
      false,
    )
    expect(
      command('Without prejudice'),
    ).toHaveProperty('disabled', false)
    openRibbonTab('References')
    expect(
      command('Insert authority'),
    ).toHaveProperty('disabled', false)
    expect(screen.queryByRole('combobox', { name: /Harvard/i })).toBeNull()
    openRibbonTab('Review')
    // The document-level Redact action is real; the ribbon entry reveals it
    // rather than claiming the capability does not exist.
    expect(
      command('Redact this document'),
    ).toHaveProperty('disabled', false)
    // Share-safe export is a live route: refusal comes from the server, not a
    // placeholder control.
    expect(
      command('Share-safe export'),
    ).toHaveProperty('disabled', false)
  })

  it('allows partial emphasis while track changes is on', () => {
    mountWorkspace({})
    selectBodyParagraph()
    const field = screen.getByLabelText('Paragraph text')
    if (!(field instanceof HTMLTextAreaElement)) {
      throw new Error('Paragraph field is missing.')
    }
    field.focus()
    field.setSelectionRange(1, 4)
    fireEvent.select(field)
    openRibbonTab('Review')
    fireEvent.click(command('Track changes off'))
    openRibbonTab('Home')
    const bold = command('Bold')
    expect(bold).toHaveProperty('disabled', false)
    // The tracked range formats as a pending draft, not a refused control.
    fireEvent.click(bold)
    expect(command('Save')).toHaveProperty(
      'disabled',
      false,
    )
  })

  it('replaces find hits and lists extracted authorities', () => {
    mountWorkspace({})
    selectBodyParagraph()
    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'See [2024] UKSC 3' },
    })
    openRibbonTab('Review')
    fireEvent.change(screen.getByLabelText('Find in document'), {
      target: { value: 'See' },
    })
    fireEvent.change(screen.getByLabelText('Replace in document'), {
      target: { value: 'Read' },
    })
    fireEvent.click(command('Replace'))
    expect(screen.getByLabelText('Paragraph text')).toHaveProperty(
      'value',
      'Read [2024] UKSC 3',
    )
    openRibbonTab('References')
    fireEvent.click(command('List of authorities'))
    expect(command('[2024] UKSC 3')).toBeTruthy()
  })

  it('closes an open margin story when an authority row is selected', () => {
    mountWorkspace({
      models: {
        doc_1: {
          ...multiParagraphModel([paragraph('p1', 'See [2024] UKSC 3')]),
          stories: [
            ...multiParagraphModel([paragraph('p1', 'See [2024] UKSC 3')])
              .stories,
            {
              partName: 'word/header1.xml',
              kind: 'header' as const,
              paragraphs: [paragraph('h1', 'Running head')],
              preservedXmlFragments: [],
              fields: [],
              unanchoredFieldParagraphIds: [],
            },
          ],
        },
      },
    })
    openRibbonTab('Insert')
    fireEvent.click(command('Header'))
    const band = screen.getByLabelText('Document header')
    expect(within(band).getByLabelText('Paragraph text')).toHaveProperty(
      'value',
      'Running head',
    )
    openRibbonTab('References')
    fireEvent.click(command('List of authorities'))
    fireEvent.click(command('[2024] UKSC 3'))
    // The hit names a body paragraph: selecting it leaves margin editing the
    // way a body click does, and the caret lands where the format controls
    // can actually reach it.
    expect(within(band).queryByLabelText('Paragraph text')).toBeNull()
    expect(screen.getByLabelText('Paragraph text')).toHaveProperty(
      'value',
      'See [2024] UKSC 3',
    )
  })
})

describe('DocxWorkspace export', () => {
  it('downloads the DOCX with the expected filename', async () => {
    const blob = new Blob()
    fetchDocumentExport.mockResolvedValue({
      blob,
      skippedCommentCount: 0,
    })
    mountWorkspace({})
    openRibbonTab('Review')
    fireEvent.click(command('Export'))

    await waitFor(() => {
      expect(fetchDocumentExport).toHaveBeenCalledWith('doc_1', {
        shareSafe: undefined,
      })
    })
    expect(downloadBlob).toHaveBeenCalledWith('brief.docx', blob)
    // The only live region left is the find count; no export error announced.
    expect(
      screen
        .queryAllByRole('status')
        .filter((node) => node.textContent !== '0 found'),
    ).toEqual([])
  })

  it('surfaces an ApiError via the banner when the export fails', async () => {
    fetchDocumentExport.mockRejectedValue(
      new ApiError(
        'storage_unavailable',
        'The API could not complete the request.',
        500,
        'req_export',
      ),
    )
    mountWorkspace({})
    openRibbonTab('Review')
    fireEvent.click(command('Export'))

    await waitFor(() => {
      expect(
        screen.getByText('The API could not complete the request.'),
      ).toBeTruthy()
    })
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('requests the share-safe export under the mode and its download name', async () => {
    const blob = new Blob()
    fetchDocumentExport.mockResolvedValue({
      blob,
      skippedCommentCount: 0,
      filename: 'brief-share-safe.docx',
    })
    mountWorkspace({})
    openRibbonTab('Review')
    fireEvent.click(command('Share-safe export'))

    await waitFor(() => {
      expect(fetchDocumentExport).toHaveBeenCalledWith('doc_1', {
        shareSafe: true,
      })
    })
    expect(downloadBlob).toHaveBeenCalledWith('brief-share-safe.docx', blob)
  })

  it('surfaces a share-safe refusal instead of downloading', async () => {
    fetchDocumentExport.mockRejectedValue(
      new ApiError(
        'share_safe_export_refused',
        'This document cannot be shared safely: it still carries tracked changes, hidden text, embedded objects, or other content a share-safe export cannot prove clean.',
        422,
        'req_export',
      ),
    )
    mountWorkspace({})
    openRibbonTab('Review')
    fireEvent.click(command('Share-safe export'))

    await waitFor(() => {
      expect(screen.getByText(/cannot be shared safely/u)).toBeTruthy()
    })
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('downloads anyway and reports comments that were skipped', async () => {
    const blob = new Blob()
    fetchDocumentExport.mockResolvedValue({
      blob,
      skippedCommentCount: 2,
    })
    mountWorkspace({})
    openRibbonTab('Review')
    fireEvent.click(command('Export'))

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledWith('brief.docx', blob)
    })
    expect(
      screen.getByText(
        '2 comments could not be placed in the exported document and were skipped.',
      ),
    ).toBeTruthy()
  })
})

describe('DocxWorkspace save', () => {
  it('merges a stale-base 409 so typed edits are not discarded', async () => {
    const editAsync = vi.fn().mockRejectedValue(staleConflict)
    const mergeAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      syncId: 'sync_1',
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
      versionNumber: 2,
      outcome: 'merged',
      lineage: textEditLineage('ver_1', 'ver_2'),
    })
    mountWorkspace({ editAsync, mergeAsync })
    openRibbonTab('Review')
    selectBodyParagraph()

    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Hello world' },
    })
    fireEvent.click(command('Save'))

    await waitFor(() => {
      expect(
        screen.getByText(
          "Your changes were saved as a new version to avoid overwriting a colleague's work",
        ),
      ).toBeTruthy()
    })
    expect(commandOrNull('Reload')).toBeNull()
    expect(editAsync).toHaveBeenCalled()
    expect(mergeAsync).toHaveBeenCalled()
  })

  it('surfaces a reload banner when merge also hits a 409', async () => {
    const editAsync = vi.fn().mockRejectedValue(staleConflict)
    const mergeAsync = vi.fn().mockRejectedValue(staleConflict)
    mountWorkspace({ editAsync, mergeAsync })
    openRibbonTab('Review')
    selectBodyParagraph()

    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Hello world' },
    })
    fireEvent.click(command('Save'))

    await waitFor(() => {
      expect(
        screen.getByText('The document has changed since editing began.'),
      ).toBeTruthy()
    })
    expect(command('Reload')).toBeTruthy()
  })

  it('advances the save base to the version returned by the previous save', async () => {
    let current = 1
    const editAsync = vi.fn(async (_input: { baseVersionId?: string }) => {
      const base = `ver_${String(current)}`
      current += 1
      return {
        documentId: 'doc_1',
        versionId: `ver_${String(current)}`,
        versionNumber: current,
        lineage: textEditLineage(base, `ver_${String(current)}`),
      }
    })
    mountWorkspace({
      editAsync,
      modelFor: () => ({
        versionId: `ver_${String(current)}`,
        versionNumber: current,
        model: multiParagraphModel([paragraph('p1', 'Hello')]),
      }),
    })
    openRibbonTab('Review')
    selectBodyParagraph()

    const input = screen.getByLabelText('Paragraph text')
    fireEvent.change(input, { target: { value: 'Hello world' } })
    fireEvent.click(command('Save'))
    await waitFor(() => {
      expect(editAsync).toHaveBeenCalledTimes(1)
    })
    expect(editAsync.mock.calls[0]?.[0]).toMatchObject({
      baseVersionId: 'ver_1',
    })

    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Hello again' },
    })
    fireEvent.click(command('Save'))
    await waitFor(() => {
      expect(editAsync).toHaveBeenCalledTimes(2)
    })
    expect(editAsync.mock.calls[1]?.[0]).toMatchObject({
      baseVersionId: 'ver_2',
    })
  })
})

describe('DocxWorkspace find and undo', () => {
  it('counts matches and restores the previous draft on undo', () => {
    mountWorkspace({})
    openRibbonTab('Review')

    fireEvent.change(screen.getByLabelText('Find in document'), {
      target: { value: 'hello' },
    })
    expect(screen.getByText('1 found')).toBeTruthy()
    fireEvent.click(command('Next match'))
    expect(screen.getByText('1/1')).toBeTruthy()

    openRibbonTab('Home')
    const undo = command('Undo')
    expect(undo).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Hello world' },
    })
    expect(undo).toHaveProperty('disabled', false)
    fireEvent.click(undo)
    expect(screen.getByLabelText('Paragraph text')).toHaveProperty(
      'value',
      'Hello',
    )
  })

  it('keeps selection on the anchor paragraph after undoing a split', () => {
    mountWorkspace({})
    selectBodyParagraph()

    const editor = screen.getByLabelText('Paragraph text')
    editor.focus()
    fireEvent.keyDown(editor, { key: 'Enter' })

    const undo = command('Undo')
    expect(undo).toHaveProperty('disabled', false)
    fireEvent.click(undo)

    // The removed insert is gone, so selection must fall back to the
    // paragraph it was split from instead of pointing at nothing.
    expect(screen.getByLabelText('Paragraph text')).toHaveProperty(
      'value',
      'Hello',
    )
    expect(
      document
        .querySelector('[aria-current="true"]')
        ?.getAttribute('data-paragraph-id'),
    ).toBe('p1')
  })

  it('keeps the caret inside a pending insert when undo only rewinds text', () => {
    mountWorkspace({})
    selectBodyParagraph()

    const editor = screen.getByLabelText('Paragraph text')
    editor.focus()
    fireEvent.keyDown(editor, { key: 'Enter' })

    const insert = screen.getByLabelText<HTMLTextAreaElement>(
      'Pending paragraph text',
    )
    const before = insert.value
    fireEvent.change(insert, { target: { value: `${before} extra` } })

    const undo = command('Undo')
    expect(undo).toHaveProperty('disabled', false)
    fireEvent.click(undo)

    // The insert survived the undo (only its text was rewound), so the
    // caret must stay inside it instead of jumping to the anchor paragraph.
    expect(screen.getByLabelText('Pending paragraph text')).toHaveProperty(
      'value',
      before,
    )
    expect(
      screen.getByLabelText('Pending paragraph').getAttribute('aria-current'),
    ).toBe('true')
  })
})

describe('DocxWorkspace markings', () => {
  it('commits a marking toggle as a new version and reflects it', async () => {
    let current = 1
    const markingsAsync = vi.fn(
      (
        _input: unknown,
        callbacks?: { onSuccess?: (data: { versionId: string }) => void },
      ) => {
        current = 2
        callbacks?.onSuccess?.({ versionId: 'ver_2' })
      },
    )
    mountWorkspace({
      markingsAsync,
      modelFor: () => ({
        versionId: `ver_${String(current)}`,
        versionNumber: current,
        model: {
          ...multiParagraphModel([paragraph('p1', 'Hello')]),
          trackRevisions: false,
          markings: {
            documentKind: null,
            draft: current === 2,
            privileged: false,
            withoutPrejudice: false,
          },
        },
      }),
    })
    openRibbonTab('Layout')
    fireEvent.click(command('Draft'))

    await waitFor(() => expect(markingsAsync).toHaveBeenCalledTimes(1))
    // No flip is pending, so the request leaves the stored setting alone
    // rather than echoing the value this mount loaded with.
    expect(markingsAsync.mock.calls[0]?.[0]).toEqual({
      baseVersionId: 'ver_1',
      markings: {
        documentKind: null,
        draft: true,
        privileged: false,
        withoutPrejudice: false,
      },
    })
    // The reloaded model (ver_2) carries the marking; the control reflects it.
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Draft' })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    )
  })

  it('commits a document kind selection with the stored flags preserved', async () => {
    const markingsAsync = vi.fn()
    mountWorkspace({
      markingsAsync,
      models: {
        doc_1: {
          ...multiParagraphModel([paragraph('p1', 'Hello')]),
          trackRevisions: false,
          markings: {
            // A kind this build does not list is still offered and kept.
            documentKind: 'externally-authored-kind',
            draft: false,
            privileged: true,
            withoutPrejudice: false,
          },
        },
      },
    })
    // The document type is a radio list in the Format menu: the stored kind is
    // offered as itself, and picking another one commits the markings.
    fireEvent.click(screen.getByRole('button', { name: /^Format$/ }))
    expect(
      screen.getByRole('button', { name: 'externally-authored-kind' }),
    ).toBeTruthy()
    fireEvent.click(command('Letter before action'))

    await waitFor(() => expect(markingsAsync).toHaveBeenCalledTimes(1))
    expect(markingsAsync.mock.calls[0]?.[0]).toEqual({
      baseVersionId: 'ver_1',
      markings: {
        documentKind: 'letter',
        draft: false,
        privileged: true,
        withoutPrejudice: false,
      },
    })
  })

  it('names the unsaved-edits reason on the disabled controls', async () => {
    mountWorkspace({})
    selectBodyParagraph()
    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Unsaved' },
    })
    openRibbonTab('Layout')

    for (const name of ['Draft', 'Privileged', 'Without prejudice']) {
      const control = screen.getByRole('button', {
        name: `${name}: Save or discard unsaved edits before marking.`,
      })
      expect(control).toHaveProperty('disabled', true)
      expect(control.getAttribute('aria-pressed')).toBe('false')
    }
    expect(
      screen.getByRole('combobox', {
        name: 'Document type: Save or discard unsaved edits before marking.',
      }),
    ).toHaveProperty('disabled', true)
  })

  it('treats a stale-base 409 like a save conflict: the reload banner appears', async () => {
    const markingsAsync = vi.fn(
      (_input: unknown, callbacks?: { onError?: (error: Error) => void }) =>
        callbacks?.onError?.(staleConflict),
    )
    mountWorkspace({ markingsAsync })
    openRibbonTab('Layout')
    fireEvent.click(command('Privileged'))

    await waitFor(() => expect(markingsAsync).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.getByText('The document has changed since editing began.'),
      ).toBeTruthy(),
    )
    expect(command('Reload')).toBeTruthy()
  })
})

describe('DocxWorkspace track changes toggle', () => {
  it('opens with tracking on when the version persists w:trackRevisions', () => {
    mountWorkspace({
      models: {
        doc_1: {
          ...multiParagraphModel([paragraph('p1', 'Hello')]),
          trackRevisions: true,
        },
      },
    })
    openRibbonTab('Review')
    const toggle = command('Track changes on')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('saves a lone toggle flip as a settings-only version', async () => {
    const editAsync = vi.fn(async (_input: unknown) => ({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    }))
    mountWorkspace({ editAsync })
    openRibbonTab('Review')
    fireEvent.click(command('Track changes off'))

    // A flip with no edits is still unsaved state, and Save persists it.
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-save-state]')
          ?.getAttribute('data-save-state'),
      ).toBe('unsaved'),
    )
    fireEvent.click(command('Save'))
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))
    expect(editAsync.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ operations: [], trackChanges: true }),
    )
  })

  it('restores a pending toggle flip across a remount', async () => {
    const tracked = {
      ...multiParagraphModel([paragraph('p1', 'Hello')]),
      trackRevisions: true,
    }
    const view = mountWorkspace({ models: { doc_1: tracked } })
    openRibbonTab('Review')
    fireEvent.click(command('Track changes on'))
    await waitFor(() =>
      expect(
        commandOrNull('Track changes off'),
      ).toBeTruthy(),
    )

    // Unsaved work survives a remount through the draft store — a pending
    // flip is unsaved work, so the reopened toggle is still off.
    view.unmount()
    mountWorkspace({ models: { doc_1: tracked } })
    openRibbonTab('Review')
    await waitFor(() =>
      expect(
        commandOrNull('Track changes off'),
      ).toBeTruthy(),
    )
  })
})
