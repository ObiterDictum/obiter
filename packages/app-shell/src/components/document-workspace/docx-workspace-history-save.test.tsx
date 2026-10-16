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
  applyTrackedChangeDecisions,
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
import {
  mountWorkspace,
  openRibbonTab,
  selectBodyParagraph,
} from './docx-workspace-harness'
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
async function server(
  initial: readonly string[],
  margins?: Parameters<typeof createSyntheticDocx>[1],
) {
  let bytes = await createSyntheticDocx(initial, margins)
  let parsed = await parseDocx(bytes)
  let version = 1
  let paragraphs = toPersisted(parsed.model)

  const apply = async (
    operations: readonly DocumentEditOperation[] = [],
    trackChanges = false,
  ) => {
    const baseVersionId = `ver_${String(version)}`
    const document = await parseDocx(bytes)
    const recorder = createLineageRecorder(document.model)
    applyDocumentEdits(
      document,
      operations,
      trackChanges
        ? { author: 'Lex', date: '2026-09-27T12:00:00.000Z' }
        : undefined,
      recorder,
    )
    const canonical = canonicaliseParagraphIdentities(document)
    const nextVersion = version + 1
    const lineage = buildVersionLineage({
      recorder,
      model: document.model,
      canonicalParagraphIds: canonical,
      baseVersionId,
      versionId: `ver_${String(nextVersion)}`,
      runAddressesReliable: !trackChanges,
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
  let lastSave: Promise<void> = Promise.resolve()
  const editAsync = vi.fn(
    (input: {
      operations?: DocumentEditOperation[]
      trackChanges?: boolean
    }) => {
      const result = apply(input.operations ?? [], input.trackChanges ?? false)
      lastSave = result.then(() => undefined)
      return result
    },
  )
  // A tracked-change rejection: the same all-or-nothing decision path the API
  // uses, re-parsing the stored bytes and writing a new immutable version.
  const decideAsync = vi.fn(
    async (input: {
      baseVersionId: string
      action: 'accept' | 'reject'
      changeIds: string[]
      removeParagraphIds?: string[]
    }) => {
      // The real route refuses a stale base; enforce it so a sequential
      // multi-group save cannot pass a test that should catch the conflict.
      if (input.baseVersionId !== `ver_${String(version)}`) {
        throw new ApiError(
          'conflict_detected',
          'The document has changed since review began.',
          409,
          'req_1',
        )
      }
      const baseVersionId = input.baseVersionId
      const document = await parseDocx(bytes)
      applyTrackedChangeDecisions(
        document,
        input.changeIds,
        input.action,
        input.removeParagraphIds ?? [],
      )
      bytes = await serialiseDocx(document)
      version += 1
      parsed = await parseDocx(bytes)
      paragraphs = toPersisted(parsed.model)
      return {
        documentId: 'doc_1',
        versionId: `ver_${String(version)}`,
        versionNumber: version,
        baseVersionId,
      }
    },
  )
  return {
    editAsync,
    decideAsync,
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

function saveState() {
  return document
    .querySelector('[data-save-state]')
    ?.getAttribute('data-save-state')
}

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
      waitForSave: () => Promise<void>
    }
  | ReturnType<typeof vi.fn>

function saveMock(target: SaveTarget) {
  return typeof target === 'function' ? target : target.editAsync
}

async function clickSaveAndSettle(target: SaveTarget, calls: number) {
  fireEvent.click(saveButton())
  const mock = saveMock(target)
  await waitFor(() => expect(mock).toHaveBeenCalledTimes(calls))
  // The real pipeline is asynchronous: wait for the request to resolve before
  // the caller inspects persisted state.
  if (typeof target !== 'function' && 'waitForSave' in target) {
    await act(async () => {
      await target.waitForSave()
    })
  } else {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

/** Saves a pending tracked reversal and waits for the decision request. */
async function clickDecisionSave(
  document: Awaited<ReturnType<typeof server>>,
  calls: number,
) {
  fireEvent.click(saveButton())
  await waitFor(() => expect(document.decideAsync).toHaveBeenCalledTimes(calls))
  await act(async () => {
    await Promise.resolve()
  })
}

function enableTracking() {
  openRibbonTab('Review')
  fireEvent.click(screen.getByRole('button', { name: 'Track changes off' }))
  openRibbonTab('Home')
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

  it('reverses a saved highlight, strikethrough and vertical align after Undo', async () => {
    const document = await server(['Hello', 'tail'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    fireEvent.click(screen.getByText('Hello'))
    nativeSelect(0, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Strikethrough' }))
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    fireEvent.click(screen.getByRole('button', { name: 'Superscript' }))
    expect(
      paintedDecorations().some((style) => style.verticalAlign === 'super'),
    ).toBe(true)
    await clickSaveAndSettle(document, 1)

    // Undo across the save reverses the formatting against the saved document:
    // the pre-save run had none of these properties, and a reversal that only
    // restated bold/italic/underline would leave them painted.
    fireEvent.click(undoButton())
    const after = paintedDecorations()
    expect(after.some((style) => style.verticalAlign !== '')).toBe(false)
    expect(after.some((style) => style.backgroundColor !== '')).toBe(false)
    expect(
      after.some((style) => style.textDecoration.includes('line-through')),
    ).toBe(false)
    expect(document.editAsync).toHaveBeenCalledTimes(1)
  })

  it('restores a saved first-paragraph deletion before the first survivor', async () => {
    const document = await server(['Alpha', 'Beta'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000001')
    fireEvent.click(screen.getByRole('button', { name: 'Delete paragraph' }))
    await clickSaveAndSettle(document, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Beta'])

    fireEvent.click(undoButton())
    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Alpha', 'Beta'])
  })

  it('restores a saved last-paragraph deletion after its neighbour', async () => {
    const document = await server(['Alpha', 'Beta'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000002')
    fireEvent.click(screen.getByRole('button', { name: 'Delete paragraph' }))
    await clickSaveAndSettle(document, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Alpha'])

    fireEvent.click(undoButton())
    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Alpha', 'Beta'])
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

  it('reverses a saved insert and a run edit without retargeting a neighbour', async () => {
    // `insert after Alpha` shifts every later run's positional id, and Gamma's
    // edit rides on the same save. Undo must reverse Gamma at the run that
    // continues Gamma, never at the run that inherited its old number.
    const document = await server(['Alpha', 'Beta', 'Gamma'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000003')
    fireEvent.change(field(), { target: { value: 'GAMMA' } })
    clickParagraph('para-000001')
    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Inserted' },
    })
    await clickSaveAndSettle(document, 1)
    expect(persistedText(document.paragraphs)).toEqual([
      'Alpha',
      'Inserted',
      'Beta',
      'GAMMA',
    ])

    // Three history steps: the typing, the insert, and Gamma's edit.
    fireEvent.click(undoButton())
    fireEvent.click(undoButton())
    fireEvent.click(undoButton())
    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ])
  })

  it('reverses a bold-range split and a run edit together', async () => {
    // Formatting range over 'Al' splits Alpha's run, so Beta's run number
    // moves. The saved Beta edit must still reverse at Beta.
    const document = await server(['Alpha', 'Beta'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000001')
    nativeSelect(0, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    clickParagraph('para-000002')
    fireEvent.change(field(), { target: { value: 'BETA' } })
    await clickSaveAndSettle(document, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Alpha', 'BETA'])

    fireEvent.click(undoButton())
    fireEvent.click(undoButton())
    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Alpha', 'Beta'])
  })

  it('keeps typing made during a run-shifting save on the right paragraph', async () => {
    // A save that inserts before Beta renumbers every later run. Text typed
    // while that save is in flight was not in it, so it must follow the run
    // that continues Beta, not the run that inherited Beta's old number.
    const document = await server(['Alpha', 'Beta'])
    let resolveFirst: (value: unknown) => void = () => undefined
    let applyPromise: Promise<unknown> = Promise.resolve()
    const editAsync = vi
      .fn()
      .mockImplementationOnce(
        (input: { operations?: DocumentEditOperation[] }) =>
          new Promise((resolve) => {
            resolveFirst = () => {
              applyPromise = document.apply(input.operations ?? [])
              resolve(applyPromise)
            }
          }),
      )
      .mockImplementation((input: { operations?: DocumentEditOperation[] }) =>
        document.editAsync(input),
      )
    mountWorkspace({
      editAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000001')
    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Inserted' },
    })
    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))

    // Type into Beta while the insert is in flight. This edit was not sent.
    clickParagraph('para-000002')
    fireEvent.change(field(), { target: { value: 'BETA' } })
    await act(async () => {
      resolveFirst(undefined)
      await applyPromise
    })

    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickSaveAndSettle(
      { editAsync, waitForSave: document.waitForSave },
      2,
    )
    // The in-flight text lands on Beta; the inserted paragraph is not doubled
    // and no neighbour is overwritten.
    expect(persistedText(document.paragraphs)).toEqual([
      'Alpha',
      'Inserted',
      'BETA',
    ])
  })

  it('reverses a saved tracked text replacement by rejecting its change', async () => {
    const document = await server(['Hello', 'tail'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    enableTracking()
    selectBodyParagraph()
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(document, 1)

    // The tracked save succeeded and the run now lives in `w:del`/`w:ins`,
    // absent from the paragraph model. The visible change is recorded.
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(
      document
        .modelFor()
        .model.changes.map((change) => [change.kind, change.text]),
    ).toEqual([
      ['delete', 'Hello'],
      ['insert', 'Hello world'],
    ])

    // Undo reverses the saved tracked edit against the saved document as a
    // rejection, not as a text edit on a run the model does not have.
    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickDecisionSave(document, 1)
    expect(document.decideAsync).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reject' }),
    )

    // A fresh reload shows the pre-edit text and no remaining changes. The
    // rejected change id is consumed, so redo is not offered rather than
    // targeting an obsolete id.
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(persistedText(document.paragraphs)).toEqual(['Hello', 'tail'])
    expect(document.modelFor().model.changes).toHaveLength(0)
    expect(redoButton()).toHaveProperty('disabled', true)
  })

  it('does not report saved while a tracked rejection is pending', async () => {
    const document = await server(['Hello'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    enableTracking()
    selectBodyParagraph()
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))

    fireEvent.click(undoButton())
    // The reversal is real unsaved work, never silently reported as saved.
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    expect(saveButton()).toHaveProperty('disabled', false)
  })

  it('reverses a saved tracked paragraph deletion', async () => {
    const document = await server(['Alpha', 'Beta'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    enableTracking()
    fireEvent.click(screen.getByText('Beta'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete paragraph' }))
    await clickSaveAndSettle(document, 1)

    // A tracked deletion leaves the paragraph in the model with no runs.
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(document.modelFor().model.changes[0]?.kind).toBe('delete')

    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickDecisionSave(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(persistedText(document.paragraphs)).toEqual(['Alpha', 'Beta'])
    expect(document.modelFor().model.changes).toHaveLength(0)
  })

  it('reverses a saved tracked insertion by rejecting it and removing the shell', async () => {
    const document = await server(['Alpha', 'Beta'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    enableTracking()
    fireEvent.click(screen.getByText('Alpha'))
    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Mid' },
    })
    await clickSaveAndSettle(document, 1)

    // A tracked insertion reparses to an empty paragraph carrying its `w:ins`.
    // The lineage names that shell's reversal, so the save does not block: the
    // editor stays usable and undo removes the paragraph in one decision.
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(undoButton()).toHaveProperty('disabled', false)
    expect(document.decideAsync).toHaveBeenCalledTimes(0)

    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickDecisionSave(document, 1)
    expect(document.decideAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reject',
        removeParagraphIds: expect.arrayContaining([
          expect.stringMatching(/^para-w14-/u),
        ]),
      }),
    )
    await waitFor(() => expect(saveState()).toBe('saved'))
    // One atomic decision restored the pre-insertion document exactly.
    expect(persistedText(document.paragraphs)).toEqual(['Alpha', 'Beta'])
    expect(document.modelFor().model.changes).toHaveLength(0)
  })

  it('reverses a saved tracked emphasis as a rejection', async () => {
    const document = await server(['Hello'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    enableTracking()
    selectBodyParagraph()
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(document.modelFor().model.changes[0]?.elementName).toBe('rPrChange')

    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickDecisionSave(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(document.modelFor().model.changes).toHaveLength(0)
  })

  it("sends a replacement's del and ins changes as one rejection unit", async () => {
    const document = await server(['Hello'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    enableTracking()
    selectBodyParagraph()
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))

    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickDecisionSave(document, 1)
    const call = document.decideAsync.mock.calls[0]?.[0] as {
      changeIds: string[]
    }
    // Both records of the one replacement are rejected together.
    expect(call.changeIds).toHaveLength(2)
  })

  it('sends every group of a multi-operation undo as one atomic decision', async () => {
    const document = await server(['Alpha', 'Beta'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    enableTracking()
    clickParagraph('para-000001')
    fireEvent.change(field(), { target: { value: 'ALPHA' } })
    clickParagraph('para-000002')
    fireEvent.change(field(), { target: { value: 'BETA' } })
    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))

    // The oldest snapshot carries both reversal groups. One save must send one
    // decision: two sequential calls would commit the first and conflict the
    // second, leaving a partial reversal.
    fireEvent.click(undoButton())
    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickDecisionSave(document, 1)
    const call = document.decideAsync.mock.calls[0]?.[0] as {
      changeIds: string[]
    }
    // Two replacements -> four records in one atomic decision.
    expect(call.changeIds).toHaveLength(4)
    expect(document.decideAsync).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(persistedText(document.paragraphs)).toEqual(['Alpha', 'Beta'])
    expect(document.modelFor().model.changes).toHaveLength(0)
  })

  it('holds saves until the decision version model reloads', async () => {
    const document = await server(['Hello'])
    let served = document.modelFor()
    const editAsync = vi.fn(async (input: never) => {
      const result = await document.editAsync(input)
      served = document.modelFor()
      return result
    })
    // The decision commits but the result model lags, as a real refetch does.
    const decideAsync = vi.fn((input: never) => document.decideAsync(input))
    mountWorkspace({ editAsync, decideAsync, modelFor: () => served })
    enableTracking()
    selectBodyParagraph()
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(
      { editAsync, waitForSave: document.waitForSave },
      1,
    )
    served = document.modelFor()

    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickDecisionSave(document, 1)
    // The new base is committed while the served model is still the old one:
    // a save now would plan against pre-decision run ids, so it is held.
    await waitFor(() => expect(saveState()).toBe('saving'))
    expect(saveButton()).toHaveProperty('disabled', true)
    fireEvent.click(saveButton())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.editAsync).toHaveBeenCalledTimes(1)

    // Once the decision model is served, the gate clears and the next edit
    // saves against the new base. The field change forces the render.
    served = document.modelFor()
    fireEvent.change(field(), { target: { value: 'Hello there' } })
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickSaveAndSettle(
      { editAsync, waitForSave: document.waitForSave },
      2,
    )
    expect(document.editAsync).toHaveBeenCalledTimes(2)
  })

  it('retains a tracked rejection when the decision base is stale', async () => {
    const document = await server(['Hello'])
    let conflict = true
    const decideAsync = vi.fn(async (input: never) => {
      if (conflict) {
        throw new ApiError(
          'conflict_detected',
          'The document moved.',
          409,
          'r1',
        )
      }
      return document.decideAsync(input)
    })
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync,
      modelFor: document.modelFor,
    })
    enableTracking()
    selectBodyParagraph()
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))

    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    fireEvent.click(saveButton())
    await waitFor(() => expect(saveState()).toBe('stale'))
    expect(decideAsync).toHaveBeenCalledTimes(1)
    // The reversal is retained, not lost to the failed base.
    conflict = false
    fireEvent.click(saveButton())
    await waitFor(() => expect(decideAsync).toHaveBeenCalledTimes(2))
    await act(async () => {
      await Promise.resolve()
    })
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(persistedText(document.paragraphs)).toEqual(['Hello'])
  })

  it('blocks when a newer version replaces the expected reload', async () => {
    const document = await server(['Hello'])
    const base = document.modelFor
    let newer = false
    const editAsync = vi.fn(async (input: never) => {
      const result = await document.editAsync(input)
      newer = true
      return result
    })
    const modelFor = (_id: string) => {
      const current = base()
      return newer
        ? { ...current, versionId: 'ver_99', versionNumber: 99 }
        : current
    }
    mountWorkspace({ editAsync, modelFor })
    selectBodyParagraph()
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(
      { editAsync, waitForSave: document.waitForSave },
      1,
    )

    // The committed version is no longer served, so its model can never
    // resolve the reversal. The workspace must say so and stop, not wedge on
    // "Saving…" with an enabled-but-inert Save.
    await waitFor(() => expect(saveState()).toBe('blocked'))
    expect(screen.getByText(/moved to a newer version/i)).toBeTruthy()
    expect(saveButton()).toHaveProperty('disabled', true)
    expect(document.editAsync).toHaveBeenCalledTimes(1)
  })

  it('ignores a stale reload and resolves on the exact version', async () => {
    const document = await server(['Hello'])
    const beforeModel = document.modelFor().model
    let stale = false
    const editAsync = vi.fn(async (input: never) => {
      const result = await document.editAsync(input)
      stale = true
      return result
    })
    // A stale response is the pre-save model under an older version, not the
    // saved model mislabelled: the editor still renders the base content.
    const modelFor = (_id: string) =>
      stale
        ? { versionId: 'ver_0', versionNumber: 0, model: beforeModel }
        : document.modelFor()
    mountWorkspace({ editAsync, modelFor })
    selectBodyParagraph()
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(
      { editAsync, waitForSave: document.waitForSave },
      1,
    )

    // The stale response is ignored; a later render carrying the exact saved
    // version resolves the boundary without corruption.
    stale = false
    fireEvent.change(field(), { target: { value: 'Hello world!' } })
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello world!'])
  })

  it('surfaces a failed reload and recovers on retry without resending', async () => {
    const document = await server(['Hello'])
    const beforeModel = document.modelFor().model
    let reloadFails = false
    const editAsync = vi.fn(async (input: never) => {
      const result = await document.editAsync(input)
      reloadFails = true
      return result
    })
    // A failed refetch leaves the last successful model in the cache: the
    // pre-save version, with no route to the committed version's identities.
    const modelFor = (_id: string) =>
      reloadFails
        ? { versionId: 'ver_1', versionNumber: 1, model: beforeModel }
        : document.modelFor()
    mountWorkspace({ editAsync, modelFor, modelError: () => reloadFails })
    selectBodyParagraph()
    fireEvent.change(field(), { target: { value: 'Hello world' } })
    await clickSaveAndSettle(
      { editAsync, waitForSave: document.waitForSave },
      1,
    )

    await waitFor(() => expect(saveState()).toBe('blocked'))
    expect(screen.getByText(/could not be reloaded/i)).toBeTruthy()
    expect(saveButton()).toHaveProperty('disabled', true)
    // Recovery never resends the committed save.
    expect(document.editAsync).toHaveBeenCalledTimes(1)

    reloadFails = false
    fireEvent.change(field(), { target: { value: 'Hello world!' } })
    await waitFor(() => expect(saveState()).not.toBe('blocked'))
    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello world!'])
  })

  it('survives repeated save, undo and new-edit cycles', async () => {
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

    fireEvent.click(undoButton())
    expect(field().value).toBe('Hello')
    fireEvent.change(field(), { target: { value: 'Hello three' } })
    await clickSaveAndSettle(document, 3)
    expect(persistedText(document.paragraphs)).toEqual(['Hello three'])
    expect(document.editAsync).toHaveBeenCalledTimes(3)
  })

  it('keeps a per-character tracked run undoable after it is saved', async () => {
    const document = await server(['IN THE HIGH COURT OF JUSTICE'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    enableTracking()
    fireEvent.click(screen.getByText('IN THE HIGH COURT OF JUSTICE'))

    // Type the way a keyboard does: one change event per character. The run
    // coalesces, so the save translates the run's snapshots, not each keystroke.
    let value = 'IN THE HIGH COURT OF JUSTICE'
    for (const character of ' TRACKED') {
      value += character
      fireEvent.change(field(), { target: { value } })
    }
    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))

    // The saved tracked run is still one undo, and the whole run's snapshots
    // became the same tracked-change rejection. One undo is therefore enough to
    // offer the reversal, which saves as a single decision.
    expect(undoButton()).toHaveProperty('disabled', false)
    expect(redoButton()).toHaveProperty('disabled', true)
    fireEvent.click(undoButton())
    await clickDecisionSave(document, 1)
    expect(document.decideAsync).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reject' }),
    )
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(persistedText(document.paragraphs)).toEqual([
      'IN THE HIGH COURT OF JUSTICE',
    ])
  })
})

describe('saving a margin story', () => {
  it('resolves the history boundary so a second header save needs no reload', async () => {
    const document = await server(['Body'], { header: 'Page header' })
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })

    openRibbonTab('Insert')
    fireEvent.click(screen.getByRole('button', { name: 'Header' }))
    clickParagraph(marginParagraphId())
    // Two edits leave an undo snapshot holding a margin draft across the
    // boundary: the save must reconcile it against the reloaded model's
    // margin paragraph identity instead of parking it on a positional id
    // the reloaded model does not carry.
    fireEvent.change(field(), { target: { value: 'Page header edited' } })
    fireEvent.change(field(), { target: { value: 'Page header edited again' } })
    await clickSaveAndSettle(document, 1)

    // The committed boundary must reconcile against the new version: no
    // lineageUnresolved banner, and the workspace keeps saving without the
    // reload the unresolved state used to force between margin saves.
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()

    // Undo restores the first edit. The reversal is only sendable when the
    // boundary keyed it to the reloaded header paragraph's run — the stale
    // positional paragraph id left it a pending placeholder no save can send.
    openRibbonTab('Home')
    fireEvent.click(undoButton())
    await clickSaveAndSettle(document, 2)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })

  it('reconciles a body save that inserts a page number so a second save runs', async () => {
    const document = await server(['Page body'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000001', 'Page body'.length)
    openRibbonTab('Insert')
    fireEvent.click(screen.getByRole('button', { name: 'Page number' }))
    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()

    fireEvent.change(field(), { target: { value: 'Page body edited' } })
    await clickSaveAndSettle(document, 2)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })

  it('reconciles a margin save that inserts a page number so a second save runs', async () => {
    const document = await server(['Body'], { header: 'Page header' })
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })

    openRibbonTab('Insert')
    fireEvent.click(screen.getByRole('button', { name: 'Header' }))
    clickParagraph(marginParagraphId(), 'Page header'.length)
    fireEvent.click(screen.getByRole('button', { name: 'Page number' }))
    await clickSaveAndSettle(document, 1)

    // A snapshot predating the saved field used to block the whole boundary:
    // no operation removes a stored splice, so the translation refused it.
    // For a page number the stored field is baseline content, so the
    // boundary must reconcile and the save settle without a reload.
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()

    // A second margin save without reloading must reach the server.
    fireEvent.change(field(), { target: { value: 'Page header edited' } })
    await clickSaveAndSettle(document, 2)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(document.editAsync).toHaveBeenCalledTimes(2)
  })
})

describe('saving a footnote', () => {
  it('reconciles a body save that inserts a footnote so a second save runs', async () => {
    const document = await server(['Page body'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000001', 'Page body'.length)
    openRibbonTab('Insert')
    fireEvent.click(screen.getByRole('button', { name: 'Footnote' }))

    // The insertion opens the notes story with the caret in the folded
    // note body, so the field now edits that pending paragraph.
    fireEvent.change(field(), { target: { value: 'A note' } })
    await clickSaveAndSettle(document, 1)

    // A snapshot predating the saved footnote used to block the whole
    // boundary: restoring it would need a removal no operation expresses,
    // so the translation refused it and every later save demanded a
    // reload. The stored reference and its note entry are baseline
    // content, so the boundary must reconcile and the save settle.
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()

    // A second save on the body, after the story closes, must reach the
    // server without a reload.
    fireEvent.click(screen.getByRole('button', { name: 'Close footnotes' }))
    selectBodyParagraph('Page body')
    fireEvent.change(field(), { target: { value: 'Page body edited' } })
    await clickSaveAndSettle(document, 2)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(document.editAsync).toHaveBeenCalledTimes(2)
  })
})

/** The editable band paragraph's id — the only one inside the header band. */
function marginParagraphId() {
  const node = screen
    .getByLabelText('Document header')
    .querySelector('[data-paragraph-id]')
  const id = node?.getAttribute('data-paragraph-id')
  if (!id) throw new Error('no margin paragraph rendered')
  return id
}

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

/** The inline style of every painted run span in the body. */
function paintedDecorations(): CSSStyleDeclaration[] {
  return [...document.querySelectorAll('[data-caret-run-overlay] span')]
    .filter((span): span is HTMLElement => span instanceof HTMLElement)
    .map((span) => span.style)
}
