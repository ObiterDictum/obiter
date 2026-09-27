import '@obiter/test-dom'
/*
 * E50: Undo across a successful save. A save commits the covered slots and
 * advances the loaded model, but the in-memory history snapshots were taken
 * against the pre-save baseline. Replaying one therefore reintroduces a slot
 * the server already stored, and the next save resends it. These regressions
 * drive a stateful server stand-in that re-parses identities the way the real
 * `/model` route does, so a replay shows up as a duplicated persisted
 * paragraph or a resurrected saved edit, not just a second request.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentModelWire } from '@obiter/contracts'
import { ApiError } from '../../api'
import { emptyDraftState } from '../../document-save-plan'
import { writeDocumentDraft } from '../../document-draft-store'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  selectBodyParagraph,
} from './docx-workspace-harness'
import { clickParagraph, nativeSelect } from './paragraph-selection-harness'

function pad(value: number) {
  return String(value).padStart(6, '0')
}

/**
 * The persisted document, held the way the server holds it: paragraph text in
 * order, with identities re-parsed from the stored package after every save.
 * A paragraph that moves therefore changes id, exactly as the real parser's
 * sequential allocator does.
 */
type PersistedParagraph = { runs: Array<{ text: string }> }

function persistedModel(
  paragraphs: readonly PersistedParagraph[],
): DocumentModelWire {
  let run = 0
  return multiParagraphModel(
    paragraphs.map((item, index) => {
      const id = `para-${pad(index + 1)}`
      return {
        id,
        runs: item.runs.map((entry) => {
          run += 1
          return {
            id: `text-${pad(run)}`,
            text: entry.text,
            preservedXmlFragments: [],
          }
        }),
        preservedXmlFragments: [],
      }
    }),
  )
}

function paragraphIndexOf(model: DocumentModelWire, id: string) {
  return (model.stories[0]?.paragraphs ?? []).findIndex(
    (item) => item.id === id,
  )
}

function runLocation(model: DocumentModelWire, runId: string) {
  const paragraphs = model.stories[0]?.paragraphs ?? []
  for (let p = 0; p < paragraphs.length; p += 1) {
    const runs = paragraphs[p]?.runs ?? []
    for (let r = 0; r < runs.length; r += 1) {
      if (runs[r]?.id === runId) return { paragraph: p, run: r }
    }
  }
  return null
}

type EditOperation = {
  type: string
  runId?: string
  paragraphId?: string
  text?: string
  runs?: Array<{ text: string }>
}

/**
 * Applies a request's operations to the persisted document and advances the
 * version. The returned ids are the ones a fresh parse would allocate, so the
 * client has to translate history onto them rather than assume its own.
 */
function server(initial: readonly PersistedParagraph[]) {
  const paragraphs: PersistedParagraph[] = initial.map((item) => ({
    runs: item.runs.map((run) => ({ ...run })),
  }))
  let version = 1
  const apply = (operations: readonly EditOperation[] | undefined) => {
    const model = persistedModel(paragraphs)
    for (const operation of operations ?? []) {
      if (operation.type === 'replace_run_text') {
        const at = operation.runId ? runLocation(model, operation.runId) : null
        if (at && paragraphs[at.paragraph]?.runs[at.run]) {
          paragraphs[at.paragraph].runs[at.run].text = operation.text ?? ''
        }
      } else if (operation.type === 'insert_paragraph_after') {
        const at = operation.paragraphId
          ? paragraphIndexOf(model, operation.paragraphId)
          : -1
        if (at >= 0) {
          const runs =
            operation.runs && operation.runs.length > 0
              ? operation.runs.map((run) => ({ text: run.text }))
              : [{ text: operation.text ?? '' }]
          paragraphs.splice(at + 1, 0, { runs })
        }
      } else if (operation.type === 'delete_paragraph') {
        const at = operation.paragraphId
          ? paragraphIndexOf(model, operation.paragraphId)
          : -1
        if (at >= 0) paragraphs.splice(at, 1)
      }
    }
    version += 1
    return {
      documentId: 'doc_1',
      versionId: `ver_${String(version)}`,
      versionNumber: version,
    }
  }
  const editAsync = vi.fn(async (input: { operations?: EditOperation[] }) =>
    apply(input.operations),
  )
  return {
    editAsync,
    apply,
    paragraphs,
    modelFor: () => ({
      versionId: `ver_${String(version)}`,
      versionNumber: version,
      model: persistedModel(paragraphs),
    }),
  }
}

function field(): HTMLTextAreaElement {
  const editor = screen.getByLabelText('Paragraph text')
  if (!(editor instanceof HTMLTextAreaElement)) {
    throw new Error('Paragraph field is missing.')
  }
  return editor
}

const undoButton = () => screen.getByRole('button', { name: 'Undo' })
const redoButton = () => screen.getByRole('button', { name: 'Redo' })
const saveButton = () => screen.getByRole('button', { name: 'Save' })

function persistedText(paragraphs: readonly PersistedParagraph[]) {
  return paragraphs.map((item) => item.runs.map((run) => run.text).join(''))
}

/** Distinct paragraphs rendered, so a duplicated insert is visible. */
function renderedParagraphCount() {
  return new Set(
    [...document.querySelectorAll('[data-paragraph-id]')].map((node) =>
      node.getAttribute('data-paragraph-id'),
    ),
  ).size
}

function clickSaveAndSettle(
  editAsync: ReturnType<typeof vi.fn>,
  calls: number,
) {
  fireEvent.click(saveButton())
  return waitFor(() => expect(editAsync).toHaveBeenCalledTimes(calls))
}

describe('undo across a successful save', () => {
  it('reverses a saved text edit and persists the reversal once', async () => {
    const document = server([{ runs: [{ text: 'Hello' }] }])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(document.editAsync, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Hello world'])

    // The save reloads the model with the saved text; undo must reverse that
    // against the saved document, not merely step back to a stale baseline.
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')

    await clickSaveAndSettle(document.editAsync, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello'])
  })

  it('reverses a saved local insert without replaying it', async () => {
    const document = server([{ runs: [{ text: 'Hello' }] }])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph()

    // Insert, then type into it: the history now holds a snapshot taken while
    // the insert was live, which is what undo-after-save used to resurrect.
    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Second' },
    })
    await clickSaveAndSettle(document.editAsync, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Hello', 'Second'])
    expect(renderedParagraphCount()).toBe(2)

    // Undo the typing, then the insert. Both are against the saved document,
    // so the paragraph is removed rather than queued for a second insertion.
    fireEvent.click(undoButton())
    fireEvent.click(undoButton())
    expect(renderedParagraphCount()).toBe(1)

    await clickSaveAndSettle(document.editAsync, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello'])
  })

  it('reverses a saved mid-document insert without deleting its neighbour', async () => {
    const document = server([
      { runs: [{ text: 'Alpha' }] },
      { runs: [{ text: 'Beta' }] },
      { runs: [{ text: 'Gamma' }] },
    ])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    fireEvent.click(screen.getByText('Alpha'))

    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Inserted' },
    })
    await clickSaveAndSettle(document.editAsync, 1)
    expect(persistedText(document.paragraphs)).toEqual([
      'Alpha',
      'Inserted',
      'Beta',
      'Gamma',
    ])

    // Undo the typing, then the insert. The saved insert is a real paragraph
    // the server already stores, so the reversal deletes exactly that paragraph
    // and leaves every original one alone.
    fireEvent.click(undoButton())
    fireEvent.click(undoButton())
    await clickSaveAndSettle(document.editAsync, 2)
    expect(persistedText(document.paragraphs)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ])
  })

  it('reverses a saved split without replaying it', async () => {
    const document = server([{ runs: [{ text: 'Hello' }] }])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph()

    const editor = field()
    editor.focus()
    fireEvent.keyDown(editor, { key: 'Enter' })
    await clickSaveAndSettle(document.editAsync, 1)
    expect(document.paragraphs.length).toBe(2)
    expect(persistedText(document.paragraphs).join('')).toBe('Hello')

    // One undo reverses the split: the head regains the tail and the stored
    // paragraph is removed.
    fireEvent.click(undoButton())
    expect(renderedParagraphCount()).toBe(1)

    await clickSaveAndSettle(document.editAsync, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello'])
  })

  it('reverses a saved delete without replaying it', async () => {
    const document = server([
      { runs: [{ text: 'Hello' }] },
      { runs: [{ text: 'tail' }] },
    ])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000002')
    fireEvent.click(screen.getByRole('button', { name: 'Delete paragraph' }))
    await clickSaveAndSettle(document.editAsync, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Hello'])

    // Undo brings the paragraph back; saving must persist exactly one copy of
    // it, not two and not zero.
    fireEvent.click(undoButton())
    expect(renderedParagraphCount()).toBe(2)
    await clickSaveAndSettle(document.editAsync, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello', 'tail'])
  })

  it('keeps redo correct across the save boundary', async () => {
    const document = server([{ runs: [{ text: 'Hello' }] }])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(document.editAsync, 1)

    // Undo after the save creates a fresh, unsaved branch; redo restores the
    // saved content and leaves nothing to resend.
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')
    expect(redoButton()).toHaveProperty('disabled', false)
    fireEvent.click(redoButton())
    expect(field().value).toBe('Hello world')
    expect(saveButton()).toHaveProperty('disabled', true)
    expect(document.editAsync).toHaveBeenCalledTimes(1)
  })

  it('persists the right text after undo, new edit, save', async () => {
    const document = server([{ runs: [{ text: 'Hello' }] }])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello one' } })
    await clickSaveAndSettle(document.editAsync, 1)
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')

    fireEvent.change(field(), { target: { value: 'Hello two' } })
    await clickSaveAndSettle(document.editAsync, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello two'])
  })

  it('does not advance the baseline or lose history when a save fails', async () => {
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

    // Nothing committed, so the history baseline must not have moved.
    expect(field().value).toBe('Hello world')
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')
    fireEvent.click(redoButton())
    expect(field().value).toBe('Hello world')
    expect(saveButton()).toHaveProperty('disabled', false)
  })

  it('keeps an edit made during an in-flight save present and undoable', async () => {
    const document = server([{ runs: [{ text: 'Hello' }] }])
    let resolveFirst: (value: unknown) => void = () => undefined
    let heldOperations: EditOperation[] = []
    const editAsync = vi.fn().mockImplementationOnce(
      (input: { operations?: EditOperation[] }) =>
        new Promise((resolve) => {
          heldOperations = input.operations ?? []
          resolveFirst = () => resolve(document.apply(heldOperations))
        }),
    )
    mountWorkspace({
      editAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello first' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))

    // A second edit lands while the request is in flight. It was not in the
    // request, so the response must neither drop it nor clear the history.
    fireEvent.change(field(), { target: { value: 'Hello second' } })
    await act(async () => {
      resolveFirst(undefined)
    })

    expect(persistedText(document.paragraphs)).toEqual(['Hello first'])
    expect(field().value).toBe('Hello second')
    expect(saveButton()).toHaveProperty('disabled', false)
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello first')
  })

  it('does not replay a covered slot before the saved model has reloaded', async () => {
    // The commit lands before the reloaded model reaches the workspace. The
    // boundary holds the structural reversal as a pending identity, so the
    // planner cannot resend the insert even without the saved model.
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mountWorkspace({ editAsync })
    selectBodyParagraph()

    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Second' },
    })
    await clickSaveAndSettle(editAsync, 1)

    fireEvent.click(undoButton())
    fireEvent.click(saveButton())
    await new Promise((resolve) => setTimeout(resolve, 50))

    // A second save must not carry a fresh insert for the paragraph the first
    // save already stored.
    expect(editAsync).toHaveBeenCalledTimes(1)
  })

  it('reverses a saved formatting edit and keeps redo correct', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mountWorkspace({
      editAsync,
      models: {
        doc_1: multiParagraphModel([
          paragraph('p1', 'Hello'),
          paragraph('p2', 'tail'),
        ]),
      },
    })
    fireEvent.click(screen.getByText('Hello'))
    nativeSelect(0, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(paintedBold('p1')).toBe(true)
    await clickSaveAndSettle(editAsync, 1)

    // Undo after the save reverses the saved formatting against the document
    // the save produced; redo restores the saved baseline and leaves nothing
    // to resend.
    fireEvent.click(undoButton())
    expect(paintedBold('p1')).toBe(false)
    fireEvent.click(redoButton())
    expect(saveButton()).toHaveProperty('disabled', true)
    expect(editAsync).toHaveBeenCalledTimes(1)
  })

  it('clears history when a recoverable draft is adopted', () => {
    const other = {
      ...emptyDraftState(),
      drafts: { 'text-000001': 'Other tab' },
    }
    for (const tabId of ['tab_a', 'tab_b']) {
      writeDocumentDraft(
        window.localStorage,
        {
          organisationId: 'org_1',
          userId: 'usr_1',
          documentId: 'doc_1',
          tabId,
        },
        { baseVersionId: 'ver_1', state: other, held: [] },
      )
    }
    mountWorkspace({})
    selectBodyParagraph()
    fireEvent.change(field(), { target: { value: 'Hello edited' } })
    fireEvent.click(undoButton())
    expect(redoButton()).toHaveProperty('disabled', false)

    fireEvent.click(
      screen.getAllByRole('button', { name: /Restore draft from/ })[0]!,
    )

    // The adopted draft was recorded against another version, so the history
    // taken against this one must not be replayable over it.
    expect(redoButton()).toHaveProperty('disabled', true)
    expect(undoButton()).toHaveProperty('disabled', true)
  })
})

function paintedBold(paragraphId: string): boolean {
  const spans = document.querySelectorAll(
    `[data-paragraph-id="${paragraphId}"] [data-caret-run-overlay] span`,
  )
  return [...spans].some(
    (span) => span instanceof HTMLElement && span.style.fontWeight === '700',
  )
}
