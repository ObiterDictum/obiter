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
import type {
  DocumentEditOperation,
  DocumentModelWire,
} from '@obiter/contracts'
import {
  applyDocumentEdits,
  buildVersionLineage,
  canonicaliseParagraphIdentities,
  createLineageRecorder,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import { ApiError } from '../../api'
import { emptyDraftState } from '../../document-save-plan'
import { writeDocumentDraft } from '../../document-draft-store'
import { mountWorkspace, selectBodyParagraph } from './docx-workspace-harness'
import { clickParagraph, nativeSelect } from './paragraph-selection-harness'

type PersistedParagraph = { runs: Array<{ text: string }> }

function toPersisted(model: DocumentModelWire): PersistedParagraph[] {
  const story = model.stories.find((item) => item.kind === 'document')
  return (story?.paragraphs ?? []).map((item) => ({
    runs: item.runs.map((run) => ({ text: run.text })),
  }))
}

/**
 * The persisted document held the way the server holds it: real serialized
 * DOCX bytes, re-parsed by the real model parser after every save. The lineage
 * is built by the same pipeline the API uses, so a wrong-target reversal shows
 * up as the wrong persisted text, not just a second request.
 */
async function server(initial: readonly string[]) {
  let bytes = await createSyntheticDocx(initial)
  let parsed = await parseDocx(bytes)
  let version = 1
  let paragraphs = toPersisted(parsed.model)

  const apply = async (operations: readonly DocumentEditOperation[] = []) => {
    const baseVersionId = `ver_${String(version)}`
    const document = await parseDocx(bytes)
    const recorder = createLineageRecorder(document.model)
    applyDocumentEdits(document, operations, undefined, recorder)
    const canonical = canonicaliseParagraphIdentities(document)
    const nextVersion = version + 1
    const lineage = buildVersionLineage({
      recorder,
      model: document.model,
      canonicalParagraphIds: canonical,
      baseVersionId,
      versionId: `ver_${String(nextVersion)}`,
    })
    bytes = await serialiseDocx(document)
    version = nextVersion
    parsed = await parseDocx(bytes)
    paragraphs = toPersisted(parsed.model)
    return {
      documentId: 'doc_1',
      versionId: `ver_${String(version)}`,
      versionNumber: version,
      lineage,
    }
  }
  let lastSave: Promise<unknown> = Promise.resolve()
  const editAsync = vi.fn((input: { operations?: DocumentEditOperation[] }) => {
    lastSave = apply(input.operations ?? [])
    return lastSave
  })
  return {
    editAsync,
    apply,
    waitForSave: () => lastSave,
    get paragraphs() {
      return paragraphs
    },
    modelFor: () => ({
      versionId: `ver_${String(version)}`,
      versionNumber: version,
      model: parsed.model,
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

type SaveTarget =
  | {
      editAsync: ReturnType<typeof vi.fn>
      waitForSave: () => Promise<unknown>
    }
  | ReturnType<typeof vi.fn>

function saveMock(target: SaveTarget) {
  return typeof target === 'function' ? target : target.editAsync
}

async function clickSaveAndSettle(target: SaveTarget, calls: number) {
  fireEvent.click(saveButton())
  const mock = saveMock(target)
  await waitFor(() => expect(mock).toHaveBeenCalledTimes(calls))
  // The real pipeline is asynchronous: wait for the request to resolve and for
  // React to apply the commit/reload before the caller inspects persisted state.
  await act(async () => {
    if (typeof target !== 'function' && 'waitForSave' in target) {
      await target.waitForSave()
    } else {
      await Promise.resolve()
    }
  })
}

describe('undo across a successful save', () => {
  it('reverses a saved text edit and persists the reversal once', async () => {
    const document = await server(['Hello'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(document, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Hello world'])

    // The save reloads the model with the saved text; undo must reverse that
    // against the saved document, not merely step back to a stale baseline.
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')

    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello'])
  })

  it('reverses a saved local insert without replaying it', async () => {
    const document = await server(['Hello'])
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
    await clickSaveAndSettle(document, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Hello', 'Second'])
    expect(renderedParagraphCount()).toBe(2)

    // Undo the typing, then the insert. Both are against the saved document,
    // so the paragraph is removed rather than queued for a second insertion.
    fireEvent.click(undoButton())
    fireEvent.click(undoButton())
    expect(renderedParagraphCount()).toBe(1)

    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello'])
  })

  it('reverses a saved mid-document insert without deleting its neighbour', async () => {
    const document = await server(['Alpha', 'Beta', 'Gamma'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    fireEvent.click(screen.getByText('Alpha'))

    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Inserted' },
    })
    await clickSaveAndSettle(document, 1)
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
    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ])
  })

  it('reverses a saved split without replaying it', async () => {
    const document = await server(['Hello'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph()

    const editor = field()
    editor.focus()
    fireEvent.keyDown(editor, { key: 'Enter' })
    await clickSaveAndSettle(document, 1)
    expect(document.paragraphs.length).toBe(2)
    expect(persistedText(document.paragraphs).join('')).toBe('Hello')

    // One undo reverses the split: the head regains the tail and the stored
    // paragraph is removed.
    fireEvent.click(undoButton())
    expect(renderedParagraphCount()).toBe(1)

    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello'])
  })

  it('reverses a saved delete without replaying it', async () => {
    const document = await server(['Hello', 'tail'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000002')
    fireEvent.click(screen.getByRole('button', { name: 'Delete paragraph' }))
    await clickSaveAndSettle(document, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Hello'])

    // Undo brings the paragraph back; saving must persist exactly one copy of
    // it, not two and not zero.
    fireEvent.click(undoButton())
    expect(renderedParagraphCount()).toBe(2)
    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello', 'tail'])
  })

  it('keeps redo correct across the save boundary', async () => {
    const document = await server(['Hello'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(document, 1)

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
    const document = await server(['Hello'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph()

    fireEvent.change(field(), { target: { value: 'Hello one' } })
    await clickSaveAndSettle(document, 1)
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')

    fireEvent.change(field(), { target: { value: 'Hello two' } })
    await clickSaveAndSettle(document, 2)
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
    const document = await server(['Hello'])
    let resolveFirst: (value: unknown) => void = () => undefined
    let applyPromise: Promise<unknown> = Promise.resolve()
    let heldOperations: DocumentEditOperation[] = []
    const editAsync = vi.fn().mockImplementationOnce(
      (input: { operations?: DocumentEditOperation[] }) =>
        new Promise((resolve) => {
          heldOperations = input.operations ?? []
          resolveFirst = () => {
            applyPromise = document.apply(heldOperations)
            resolve(applyPromise)
          }
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
      await applyPromise
    })

    await waitFor(() =>
      expect(persistedText(document.paragraphs)).toEqual(['Hello first']),
    )
    expect(field().value).toBe('Hello second')
    expect(saveButton()).toHaveProperty('disabled', false)
    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello first')
  })

  it('fails safely when the save response carries no lineage', async () => {
    // A committed save whose response has no authoritative lineage is an
    // inconsistent response, not permission to guess. The client must surface a
    // recoverable blocked state, refuse the next save and never silently
    // discard the reversal.
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

    // A second save must not run against the unresolved baseline.
    expect(editAsync).toHaveBeenCalledTimes(1)
    // The blocked state is honest and actionable.
    expect(
      screen.getByText(/edit history for it could not be reconciled/i),
    ).toBeTruthy()
    expect(saveButton()).toHaveProperty('disabled', true)
  })

  it('reverses a saved formatting edit and keeps redo correct', async () => {
    const document = await server(['Hello', 'tail'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    fireEvent.click(screen.getByText('Hello'))
    nativeSelect(0, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(paintedBold('Hello')).toBe(true)
    await clickSaveAndSettle(document, 1)

    // Undo after the save reverses the saved formatting against the document
    // the save produced; redo restores the saved baseline and leaves nothing
    // to resend.
    fireEvent.click(undoButton())
    expect(paintedBold('Hello')).toBe(false)
    fireEvent.click(redoButton())
    expect(saveButton()).toHaveProperty('disabled', true)
    expect(document.editAsync).toHaveBeenCalledTimes(1)
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

function paintedBold(paragraphText: string): boolean {
  const target = [...document.querySelectorAll('[data-paragraph-id]')].find(
    (node) => node.textContent?.includes(paragraphText),
  )
  if (!target) return false
  const spans = target.querySelectorAll('[data-caret-run-overlay] span')
  return [...spans].some(
    (span) => span instanceof HTMLElement && span.style.fontWeight === '700',
  )
}
