import '@obiter/test-dom'
/*
 * Redo is the reverse of the in-memory undo history. These regressions mount
 * the real workspace and drive the toolbar and shortcuts, so a redo that
 * silently restored the wrong draft, dropped the branch on a new edit, or
 * crossed documents would fail here rather than in a reviewer's browser.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentModelWire } from '@obiter/contracts'
import { ApiError } from '../../api'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  selectBodyParagraph,
} from './docx-workspace-harness'
import {
  clickParagraph,
  nativeSelect,
  placeCaret,
} from './paragraph-selection-harness'

function field(): HTMLTextAreaElement {
  const editor = screen.getByLabelText('Paragraph text')
  if (!(editor instanceof HTMLTextAreaElement)) {
    throw new Error('Paragraph field is missing.')
  }
  return editor
}

function undoButton() {
  return screen.getByRole('button', { name: 'Undo' })
}

function redoButton() {
  return screen.getByRole('button', { name: 'Redo' })
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save' })
}

function paintedBold(paragraphId: string): boolean {
  const spans = document.querySelectorAll(
    `[data-paragraph-id="${paragraphId}"] [data-caret-run-overlay] span`,
  )
  return [...spans].some(
    (span) => span instanceof HTMLElement && span.style.fontWeight === '700',
  )
}

function twoParagraphs() {
  return multiParagraphModel([
    paragraph('p1', 'Hello'),
    paragraph('p2', 'tail'),
  ])
}

/** The default one-paragraph fixture with the run id the workspace types into. */
function helloModel(text: string): DocumentModelWire {
  return multiParagraphModel([
    {
      id: 'p1',
      runs: [{ id: 'r1', text, preservedXmlFragments: [] }],
      preservedXmlFragments: [],
    },
  ])
}

/**
 * A stand-in for the server, holding the paragraphs a save has committed.
 * Applying each successful request's operations turns a slot a later save
 * resends into a visible duplicate paragraph, not merely a second request.
 */
function serverParagraphs(editAsync: ReturnType<typeof vi.fn>) {
  const paragraphs: Array<{ id: string; text: string }> = [
    { id: 'p1', text: 'Hello' },
  ]
  let version = 1
  editAsync.mockImplementation(
    async (input: { operations?: Array<Record<string, unknown>> }) => {
      for (const operation of input.operations ?? []) {
        if (operation.type === 'insert_paragraph_after') {
          const at = paragraphs.findIndex(
            (item) => item.id === operation.paragraphId,
          )
          const text = typeof operation.text === 'string' ? operation.text : ''
          paragraphs.splice(at + 1, 0, {
            id: `inserted_${String(paragraphs.length)}`,
            text,
          })
        } else if (operation.type === 'replace_run_text') {
          const paragraph = paragraphs[0]
          if (paragraph && typeof operation.text === 'string') {
            paragraph.text = operation.text
          }
        } else if (operation.type === 'delete_paragraph') {
          const at = paragraphs.findIndex(
            (item) => item.id === operation.paragraphId,
          )
          if (at >= 0) paragraphs.splice(at, 1)
        }
      }
      version += 1
      return {
        documentId: 'doc_1',
        versionId: `ver_${String(version)}`,
        versionNumber: version,
      }
    },
  )
  return paragraphs
}

describe('DocxWorkspace redo', () => {
  it('restores the edit on Redo after Undo and disables Redo again', () => {
    mountWorkspace({})
    selectBodyParagraph()

    // Nothing has been undone, so there is no branch to redo into.
    expect(redoButton()).toHaveProperty('disabled', true)
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    expect(field().value).toBe('Hello world')
    expect(redoButton()).toHaveProperty('disabled', true)

    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')
    expect(undoButton()).toHaveProperty('disabled', true)
    expect(redoButton()).toHaveProperty('disabled', false)

    fireEvent.click(redoButton())
    expect(field().value).toBe('Hello world')
    expect(redoButton()).toHaveProperty('disabled', true)
    expect(undoButton()).toHaveProperty('disabled', false)
  })

  it('steps several edits back and forward in order', () => {
    mountWorkspace({})
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello a' } })
    fireEvent.change(field(), { target: { value: 'Hello a b' } })

    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello a')
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')
    expect(redoButton()).toHaveProperty('disabled', false)

    fireEvent.click(redoButton())
    expect(field().value).toBe('Hello a')
    fireEvent.click(redoButton())
    expect(field().value).toBe('Hello a b')
    expect(redoButton()).toHaveProperty('disabled', true)
  })

  it('discards the redo branch when a new edit follows an undo', () => {
    mountWorkspace({})
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello a' } })
    fireEvent.change(field(), { target: { value: 'Hello a b' } })
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello a')
    expect(redoButton()).toHaveProperty('disabled', false)

    fireEvent.change(field(), { target: { value: 'Hello a c' } })
    expect(field().value).toBe('Hello a c')
    expect(redoButton()).toHaveProperty('disabled', true)

    // The shortcut is inert once the branch is gone, not just the button.
    fireEvent.keyDown(field(), { key: 'z', ctrlKey: true, shiftKey: true })
    expect(field().value).toBe('Hello a c')
  })

  it('restores a formatting edit across undo and redo', () => {
    mountWorkspace({ models: { doc_1: twoParagraphs() } })
    fireEvent.click(screen.getByText('Hello'))
    nativeSelect(0, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(paintedBold('p1')).toBe(true)

    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')
    expect(paintedBold('p1')).toBe(false)

    fireEvent.click(redoButton())
    expect(field().value).toBe('Hello')
    expect(paintedBold('p1')).toBe(true)
  })

  it('restores a split paragraph with its text and moves the caret into it', () => {
    mountWorkspace({})
    selectBodyParagraph()

    const editor = field()
    editor.focus()
    fireEvent.keyDown(editor, { key: 'Enter' })
    const pending = screen.getByLabelText<HTMLTextAreaElement>(
      'Pending paragraph text',
    )
    fireEvent.change(pending, { target: { value: 'World' } })

    // Undo is per edit, so the text rewinds first and the split second.
    fireEvent.click(undoButton())
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Pending paragraph text')
        .value,
    ).toBe('')
    fireEvent.click(undoButton())
    expect(screen.queryByLabelText('Pending paragraph text')).toBeNull()
    expect(field().value).toBe('Hello')

    // Redo restores the split, then the text typed into it.
    fireEvent.click(redoButton())
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Pending paragraph text')
        .value,
    ).toBe('')
    expect(
      screen.getByLabelText('Pending paragraph').getAttribute('aria-current'),
    ).toBe('true')
    fireEvent.click(redoButton())
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Pending paragraph text')
        .value,
    ).toBe('World')
  })

  it('restores a paragraph join across undo and redo', () => {
    mountWorkspace({ models: { doc_1: twoParagraphs() } })
    clickParagraph('p2')
    placeCaret(0)
    fireEvent.keyDown(field(), { key: 'Backspace' })

    expect(field().value).toBe('Hellotail')
    expect(document.querySelector('[data-paragraph-id="p2"]')).toBeNull()

    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')
    expect(document.querySelector('[data-paragraph-id="p2"]')).toBeTruthy()

    fireEvent.click(redoButton())
    expect(field().value).toBe('Hellotail')
    expect(document.querySelector('[data-paragraph-id="p2"]')).toBeNull()
  })

  it('moves focus to the surviving paragraph when a redo removes the selected stored paragraph', () => {
    mountWorkspace({ models: { doc_1: twoParagraphs() } })
    clickParagraph('p2')
    placeCaret(0)
    fireEvent.keyDown(field(), { key: 'Backspace' })
    expect(document.querySelector('[data-paragraph-id="p2"]')).toBeNull()

    fireEvent.click(undoButton())
    expect(document.querySelector('[data-paragraph-id="p2"]')).toBeTruthy()

    // The caret sits on the stored paragraph the redo is about to delete.
    clickParagraph('p2')
    fireEvent.click(redoButton())

    // Focus must not fall to body: the join target survives and takes the
    // caret, so the next typed character lands in the merged paragraph.
    expect(document.querySelector('[data-paragraph-id="p2"]')).toBeNull()
    const editor = field()
    expect(document.activeElement).toBe(editor)
    expect(editor.value).toBe('Hellotail')
    fireEvent.change(editor, { target: { value: `${editor.value}!` } })
    expect(field().value).toBe('Hellotail!')
  })

  it('routes Ctrl+Shift+Z and Ctrl+Y to redo, not undo', () => {
    mountWorkspace({})
    selectBodyParagraph()
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')

    fireEvent.keyDown(field(), { key: 'z', ctrlKey: true, shiftKey: true })
    expect(field().value).toBe('Hello world')

    fireEvent.keyDown(field(), { key: 'z', ctrlKey: true })
    expect(field().value).toBe('Hello')

    fireEvent.keyDown(field(), { key: 'y', ctrlKey: true })
    expect(field().value).toBe('Hello world')
  })

  it('leaves Redo disabled and the shortcuts inert when no branch exists', () => {
    mountWorkspace({})
    selectBodyParagraph()

    expect(undoButton()).toHaveProperty('disabled', true)
    expect(redoButton()).toHaveProperty('disabled', true)

    fireEvent.keyDown(field(), { key: 'z', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(field(), { key: 'y', ctrlKey: true })
    expect(field().value).toBe('Hello')

    // An edit that was never undone is not a redo branch either.
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    expect(field().value).toBe('Hello world')
    expect(redoButton()).toHaveProperty('disabled', true)
    fireEvent.keyDown(field(), { key: 'z', ctrlKey: true, shiftKey: true })
    expect(field().value).toBe('Hello world')
  })
})

describe('DocxWorkspace redo and save boundaries', () => {
  it('sends the redone edit on the next save', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mountWorkspace({ editAsync })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello world' } })
    fireEvent.click(undoButton())
    // Undone back to the saved content: there is nothing for save to send.
    expect(saveButton()).toHaveProperty('disabled', true)

    fireEvent.click(redoButton())
    expect(field().value).toBe('Hello world')
    expect(saveButton()).toHaveProperty('disabled', false)

    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))
    const call = editAsync.mock.calls[0]?.[0] as {
      operations?: Array<{ type: string; text?: string }>
    }
    expect(call.operations).toEqual([
      expect.objectContaining({
        type: 'replace_run_text',
        text: 'Hello world',
      }),
    ])
  })

  it('keeps the redo branch coherent when a save fails', async () => {
    const editAsync = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'storage_unavailable',
          'The API could not complete the request.',
          500,
          'req_fail',
        ),
      )
    mountWorkspace({ editAsync })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello world' } })
    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(
        screen.getByText(
          'Your changes have not been saved. The API could not complete the request.',
        ),
      ).toBeTruthy()
    })

    // The failed request sent nothing, so the edit is still unsaved and the
    // redo branch must not have swallowed it.
    expect(field().value).toBe('Hello world')
    expect(saveButton()).toHaveProperty('disabled', false)

    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')
    fireEvent.click(redoButton())
    expect(field().value).toBe('Hello world')
    expect(saveButton()).toHaveProperty('disabled', false)
  })

  it('does not let Redo resave a paragraph a successful save already covered', async () => {
    const editAsync = vi.fn()
    const persisted = serverParagraphs(editAsync)
    mountWorkspace({ editAsync })
    selectBodyParagraph()

    // Insert a paragraph, then type into it so Undo has a text step while the
    // insert itself stays in the draft state.
    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Second' },
    })
    fireEvent.click(undoButton())
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Pending paragraph text')
        .value,
    ).toBe('')

    // The save covers the insert. Redoing restores the snapshot that still
    // holds it, and a second save would insert a duplicate paragraph.
    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))
    expect(persisted.map((item) => item.text)).toEqual(['Hello', ''])

    fireEvent.click(redoButton())
    fireEvent.click(saveButton())
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(editAsync).toHaveBeenCalledTimes(1)
    expect(redoButton()).toHaveProperty('disabled', true)
    expect(persisted.map((item) => item.text)).toEqual(['Hello', ''])
  })

  it('does not resave a split paragraph a successful save already covered', async () => {
    const editAsync = vi.fn()
    const persisted = serverParagraphs(editAsync)
    mountWorkspace({ editAsync })
    selectBodyParagraph()

    const editor = field()
    editor.focus()
    fireEvent.keyDown(editor, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'split' },
    })
    fireEvent.click(undoButton())
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Pending paragraph text')
        .value,
    ).toBe('')

    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))
    expect(persisted.map((item) => item.text)).toEqual(['Hello', ''])

    fireEvent.click(redoButton())
    fireEvent.click(saveButton())
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(editAsync).toHaveBeenCalledTimes(1)
    expect(persisted.map((item) => item.text)).toEqual(['Hello', ''])
  })

  it('keeps an edit made while a save was in flight and its undo history', async () => {
    let version = 1
    let savedText = 'Hello'
    let resolveFirst: () => void = () => undefined
    const editAsync = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          // The commit lands before the reloaded model does; the model then
          // holds the version the request sent.
          resolveFirst = () => {
            version = 2
            savedText = 'Hello first'
            resolve({
              documentId: 'doc_1',
              versionId: 'ver_2',
              versionNumber: 2,
            })
          }
        }),
    )
    mountWorkspace({
      editAsync,
      modelFor: () => ({
        versionId: `ver_${String(version)}`,
        versionNumber: version,
        model: helloModel(savedText),
      }),
    })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello first' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))

    // A second edit lands while the request is in flight. It was not in the
    // request, so the response must neither drop it nor clear the history it
    // just recorded.
    fireEvent.change(field(), { target: { value: 'Hello second' } })
    await act(async () => {
      resolveFirst()
    })

    expect(field().value).toBe('Hello second')
    expect(saveButton()).toHaveProperty('disabled', false)
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello first')
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')
  })

  it('keeps an undo made while a save was in flight as unsent work', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined
    const editAsync = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    mountWorkspace({ editAsync })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello first' } })
    fireEvent.change(field(), { target: { value: 'Hello second' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))

    // The request carried the second edit, not the first, so stepping back to
    // the first must leave it editable as unsent work.
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello first')
    await act(async () => {
      resolveFirst({
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
      })
    })

    expect(field().value).toBe('Hello first')
    expect(saveButton()).toHaveProperty('disabled', false)
    // The redo branch this undo created still holds the saved edit, so the
    // save boundary drops it rather than letting a redo resend it.
    expect(redoButton()).toHaveProperty('disabled', true)
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')
  })
})
