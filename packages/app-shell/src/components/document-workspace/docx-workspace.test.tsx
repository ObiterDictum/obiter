import '@obiter/test-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { ApiError } from '../../api'
import {
  downloadBlob,
  fetchDocumentExport,
  mountWorkspace,
  multiParagraphModel,
  openRibbonTab,
  paragraph,
  selectBodyParagraph,
  staleConflict,
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

describe('DocxWorkspace ribbon', () => {
  it('keeps the ribbon outside the scrolling document desk', () => {
    mountWorkspace({})
    const desk = document.querySelector('[data-document-desk]')
    expect(desk?.querySelector('[role="tab"]')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Home' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Insert' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Layout' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'References' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Review' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'View' })).toBeTruthy()
  })

  it('wires the Home font commands and keeps the rest unavailable', () => {
    mountWorkspace({})
    for (const name of ['Font', 'Font size', 'Font colour']) {
      expect(screen.getByRole('combobox', { name })).toHaveProperty(
        'disabled',
        false,
      )
    }
    expect(
      screen.getByRole('button', { name: 'Clear formatting' }),
    ).toHaveProperty('disabled', false)
    expect(
      screen.getByRole('combobox', { name: 'Line spacing' }),
    ).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: 'Bullets' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(
      screen.getByRole('button', { name: 'Multilevel numbering' }),
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
    expect(
      screen.getByRole('button', { name: 'Privileged (not available yet)' }),
    ).toHaveProperty('disabled', true)
    openRibbonTab('References')
    expect(
      screen.getByRole('button', { name: 'Insert authority' }),
    ).toHaveProperty('disabled', false)
    expect(screen.queryByRole('combobox', { name: /Harvard/i })).toBeNull()
    openRibbonTab('Review')
    // The document-level Redact action is real; the ribbon entry reveals it
    // rather than claiming the capability does not exist.
    expect(
      screen.getByRole('button', { name: 'Redact this document' }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Track changes off' }))
    openRibbonTab('Home')
    const bold = screen.getByRole('button', { name: 'Bold' })
    expect(bold).toHaveProperty('disabled', false)
    // The tracked range formats as a pending draft, not a refused control.
    fireEvent.click(bold)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty(
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
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(screen.getByLabelText('Paragraph text')).toHaveProperty(
      'value',
      'Read [2024] UKSC 3',
    )
    openRibbonTab('References')
    fireEvent.click(screen.getByRole('button', { name: 'List of authorities' }))
    expect(screen.getByRole('button', { name: '[2024] UKSC 3' })).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: 'Header' }))
    const band = screen.getByLabelText('Document header')
    expect(within(band).getByLabelText('Paragraph text')).toHaveProperty(
      'value',
      'Running head',
    )
    openRibbonTab('References')
    fireEvent.click(screen.getByRole('button', { name: 'List of authorities' }))
    fireEvent.click(screen.getByRole('button', { name: '[2024] UKSC 3' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => {
      expect(fetchDocumentExport).toHaveBeenCalledWith('doc_1')
    })
    expect(downloadBlob).toHaveBeenCalledWith('brief.docx', blob)
    expect(screen.queryByRole('status')).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => {
      expect(
        screen.getByText('The API could not complete the request.'),
      ).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          "Your changes were saved as a new version to avoid overwriting a colleague's work",
        ),
      ).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        screen.getByText('The document has changed since editing began.'),
      ).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(editAsync).toHaveBeenCalledTimes(1)
    })
    expect(editAsync.mock.calls[0]?.[0]).toMatchObject({
      baseVersionId: 'ver_1',
    })

    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Hello again' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(screen.getByText('1/1')).toBeTruthy()

    openRibbonTab('Home')
    const undo = screen.getByRole('button', { name: 'Undo' })
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

    const undo = screen.getByRole('button', { name: 'Undo' })
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

    const undo = screen.getByRole('button', { name: 'Undo' })
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
