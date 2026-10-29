import '@obiter/test-dom'
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
  writeTrackRevisions,
} from '@obiter/ooxml'
import { ApiError } from '../../api'
import { emptyDraftState } from '../../document-save-plan'
import { writeDocumentDraft } from '../../document-draft-store'
import { openRibbonTab, setTrackChanges } from './editor-test-commands'
import {
  mountWorkspace,
  rerenderWorkspace,
  selectBodyParagraph,
  command,
  commandOrNull,
} from './docx-workspace-harness'

import { clickParagraph, nativeSelect } from './paragraph-selection-harness'

type PersistedParagraph = { runs: Array<{ text: string }> }

function toPersisted(model: DocumentModelWire): PersistedParagraph[] {
  const story = model.stories.find((item) => item.kind === 'document')
  return (story?.paragraphs ?? []).map((item) => ({
    runs: item.runs.map((run) => ({ text: run.text })),
  }))
}

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
    trackChanges?: boolean,
  ) => {
    const baseVersionId = `ver_${String(version)}`
    const document = await parseDocx(bytes)
    const recorder = createLineageRecorder(document.model)
    const tracking = trackChanges ?? document.model.trackRevisions
    if (operations.length > 0) {
      applyDocumentEdits(
        document,
        operations,
        tracking
          ? { author: 'Lex', date: '2026-09-27T12:00:00.000Z' }
          : undefined,
        recorder,
      )
    }
    if (trackChanges !== undefined) writeTrackRevisions(document, trackChanges)
    const canonical = canonicaliseParagraphIdentities(document)
    const nextVersion = version + 1
    const lineage = buildVersionLineage({
      recorder,
      model: document.model,
      canonicalParagraphIds: canonical,
      baseVersionId,
      versionId: `ver_${String(nextVersion)}`,
      runAddressesReliable: !tracking,
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
      const result = apply(input.operations ?? [], input.trackChanges)
      lastSave = result.then(() => undefined)
      return result
    },
  )
  const decideAsync = vi.fn(
    async (input: {
      baseVersionId: string
      action: 'accept' | 'reject'
      changeIds: string[]
      removeParagraphIds?: string[]
      trackRevisions?: boolean
    }) => {
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
      if (input.trackRevisions !== undefined) {
        writeTrackRevisions(document, input.trackRevisions)
      }
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

const undoButton = () => command('Undo')
const redoButton = () => command('Redo')
const saveButton = () => command('Save')

function saveState() {
  return document
    .querySelector('[data-save-state]')
    ?.getAttribute('data-save-state')
}

function persistedText(paragraphs: readonly PersistedParagraph[]) {
  return paragraphs.map((item) => item.runs.map((run) => run.text).join(''))
}

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
  setTrackChanges(true)
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

    fireEvent.click(command('Insert paragraph'))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Second' },
    })
    await clickSaveAndSettle(document, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Hello', 'Second'])
    expect(renderedParagraphCount()).toBe(2)

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

    fireEvent.click(command('Insert paragraph'))
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
    fireEvent.click(command('Delete paragraph'))
    await clickSaveAndSettle(document, 1)
    expect(persistedText(document.paragraphs)).toEqual(['Hello'])

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
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mountWorkspace({ editAsync })
    selectBodyParagraph()

    fireEvent.click(command('Insert paragraph'))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Second' },
    })
    await clickSaveAndSettle(editAsync, 1)

    fireEvent.click(undoButton())
    fireEvent.click(saveButton())
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(editAsync).toHaveBeenCalledTimes(1)
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
    fireEvent.click(command('Bold'))
    expect(paintedBold('Hello')).toBe(true)
    await clickSaveAndSettle(document, 1)

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
    fireEvent.click(command('Strikethrough'))
    fireEvent.click(command('Highlight'))
    fireEvent.click(command('Superscript'))
    expect(
      paintedDecorations().some((style) => style.verticalAlign === 'super'),
    ).toBe(true)
    await clickSaveAndSettle(document, 1)

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
    fireEvent.click(command('Delete paragraph'))
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
    fireEvent.click(command('Delete paragraph'))
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

    expect(redoButton()).toHaveProperty('disabled', true)
    expect(undoButton()).toHaveProperty('disabled', true)
  })

  it('reverses a saved insert and a run edit without retargeting a neighbour', async () => {
    const document = await server(['Alpha', 'Beta', 'Gamma'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000003')
    fireEvent.change(field(), { target: { value: 'GAMMA' } })
    clickParagraph('para-000001')
    fireEvent.click(command('Insert paragraph'))
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
    const document = await server(['Alpha', 'Beta'])
    mountWorkspace({
      editAsync: document.editAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000001')
    nativeSelect(0, 2)
    fireEvent.click(command('Bold'))
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
    fireEvent.click(command('Insert paragraph'))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Inserted' },
    })
    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))

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

    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(
      document
        .modelFor()
        .model.changes.map((change) => [change.kind, change.text]),
    ).toEqual([['insert', ' world']])

    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickDecisionSave(document, 1)
    expect(document.decideAsync).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reject' }),
    )

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
    fireEvent.click(command('Delete paragraph'))
    await clickSaveAndSettle(document, 1)

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
    fireEvent.click(command('Insert paragraph'))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Mid' },
    })
    await clickSaveAndSettle(document, 1)

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
    fireEvent.click(command('Bold'))
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
    fireEvent.change(field(), { target: { value: 'Hullo' } })
    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))

    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickDecisionSave(document, 1)
    const call = document.decideAsync.mock.calls[0]?.[0] as {
      changeIds: string[]
    }
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

    fireEvent.click(undoButton())
    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickDecisionSave(document, 1)
    const call = document.decideAsync.mock.calls[0]?.[0] as {
      changeIds: string[]
    }
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
    const decideAsync = vi.fn((input: never) => document.decideAsync(input))
    const view = mountWorkspace({
      editAsync,
      decideAsync,
      modelFor: () => served,
    })
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
    await waitFor(() => expect(saveState()).toBe('saving'))
    expect(saveButton()).toHaveProperty('disabled', true)
    fireEvent.click(saveButton())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.editAsync).toHaveBeenCalledTimes(1)

    served = document.modelFor()
    rerenderWorkspace(view, 'doc_1')
    await waitFor(() => expect(saveState()).toBe('saved'))
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

    fireEvent.change(field(), { target: { value: 'Hello world!' } })
    expect(saveButton()).toHaveProperty('disabled', true)
    stale = false
    fireEvent.change(field(), { target: { value: 'Hello world!!' } })
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    expect(saveButton()).toHaveProperty('disabled', false)
    await clickSaveAndSettle(document, 2)
    expect(persistedText(document.paragraphs)).toEqual(['Hello world!!'])
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

    let value = 'IN THE HIGH COURT OF JUSTICE'
    for (const character of ' TRACKED') {
      value += character
      fireEvent.change(field(), { target: { value } })
    }
    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))

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
    fireEvent.click(command('Header'))
    clickParagraph(marginParagraphId())
    fireEvent.change(field(), { target: { value: 'Page header edited' } })
    fireEvent.change(field(), { target: { value: 'Page header edited again' } })
    await clickSaveAndSettle(document, 1)

    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandOrNull('Reload')).toBeNull()

    openRibbonTab('Home')
    fireEvent.click(undoButton())
    await clickSaveAndSettle(document, 2)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandOrNull('Reload')).toBeNull()
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
    fireEvent.click(command('Page number'))
    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandOrNull('Reload')).toBeNull()

    fireEvent.change(field(), { target: { value: 'Page body edited' } })
    await clickSaveAndSettle(document, 2)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandOrNull('Reload')).toBeNull()
  })

  it('reconciles a margin save that inserts a page number so a second save runs', async () => {
    const document = await server(['Body'], { header: 'Page header' })
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })

    openRibbonTab('Insert')
    fireEvent.click(command('Header'))
    clickParagraph(marginParagraphId(), 'Page header'.length)
    fireEvent.click(command('Page number'))
    await clickSaveAndSettle(document, 1)

    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandOrNull('Reload')).toBeNull()

    fireEvent.change(field(), { target: { value: 'Page header edited' } })
    await clickSaveAndSettle(document, 2)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandOrNull('Reload')).toBeNull()
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
    fireEvent.click(command('Footnote'))

    fireEvent.change(field(), { target: { value: 'A note' } })
    await clickSaveAndSettle(document, 1)

    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandOrNull('Reload')).toBeNull()

    fireEvent.click(command('Close footnotes'))
    selectBodyParagraph('Page body')
    fireEvent.change(field(), { target: { value: 'Page body edited' } })
    await clickSaveAndSettle(document, 2)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandOrNull('Reload')).toBeNull()
    expect(document.editAsync).toHaveBeenCalledTimes(2)
  })
})

describe('saving an inserted structure', () => {
  it('reconciles a body save that inserts a picture so a second save runs', async () => {
    const restorePicker = stubImagePicker()
    try {
      const document = await server(['Page body'])
      mountWorkspace({
        editAsync: document.editAsync,
        decideAsync: document.decideAsync,
        modelFor: document.modelFor,
      })
      clickParagraph('para-000001', 'Page body'.length)
      openRibbonTab('Insert')
      fireEvent.click(command('Picture'))
      insertPictureFile()
      await waitFor(() => expect(saveState()).toBe('unsaved'))

      await clickSaveAndSettle(document, 1)
      await waitFor(() => expect(saveState()).toBe('saved'))
      expect(commandOrNull('Reload')).toBeNull()
      expect(document.editAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          operations: expect.arrayContaining([
            expect.objectContaining({ type: 'insert_image' }),
          ]),
        }),
      )

      fireEvent.change(field(), { target: { value: 'Page body edited' } })
      await clickSaveAndSettle(document, 2)
      await waitFor(() => expect(saveState()).toBe('saved'))
      expect(commandOrNull('Reload')).toBeNull()
      expect(document.editAsync).toHaveBeenCalledTimes(2)
    } finally {
      restorePicker()
    }
  })

  it('reconciles a body save that inserts a cross-reference so a second save runs', async () => {
    const document = await server(['Page body', 'Cited paragraph'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    clickParagraph('para-000001', 'Page body'.length)
    openRibbonTab('Insert')
    fireEvent.click(command('Cross-reference'))
    fireEvent.click(screen.getByRole('option', { name: 'Cited paragraph' }))
    fireEvent.click(command('Insert'))
    await waitFor(() => expect(saveState()).toBe('unsaved'))

    await clickSaveAndSettle(document, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandOrNull('Reload')).toBeNull()
    expect(document.editAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({ type: 'insert_cross_reference' }),
        ]),
      }),
    )

    fireEvent.change(field(), { target: { value: 'Page body edited' } })
    await clickSaveAndSettle(document, 2)
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandOrNull('Reload')).toBeNull()
    expect(document.editAsync).toHaveBeenCalledTimes(2)
  })
})

describe('undo across a saved mid-run structure', () => {
  it('reverses a run edit split by a saved picture without duplicating text', async () => {
    const restorePicker = stubImagePicker()
    try {
      const document = await server(['Hello world'])
      mountWorkspace({
        editAsync: document.editAsync,
        decideAsync: document.decideAsync,
        modelFor: document.modelFor,
      })
      selectBodyParagraph('Hello world')
      fireEvent.change(field(), { target: { value: 'Hello world typed' } })
      clickParagraph('para-000001', 5)
      openRibbonTab('Insert')
      fireEvent.click(command('Picture'))
      insertPictureFile()
      await waitFor(() => expect(saveState()).toBe('unsaved'))
      fireEvent.change(field(), { target: { value: 'Hello world typed more' } })
      await clickSaveAndSettle(document, 1)
      expect(document.paragraphs[0]?.runs.map((run) => run.text)).toEqual([
        'Hello',
        '',
        ' world typed more',
      ])

      openRibbonTab('Home')
      fireEvent.click(undoButton())
      await waitFor(() => expect(saveState()).toBe('unsaved'))
      await clickSaveAndSettle(document, 2)
      expect(document.paragraphs[0]?.runs.map((run) => run.text)).toEqual([
        'Hello',
        '',
        ' world typed',
      ])
    } finally {
      restorePicker()
    }
  })

  it('reverses a run edit split by a saved cross-reference without duplicating text', async () => {
    const document = await server(['Hello world', 'Cited paragraph'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph('Hello world')
    fireEvent.change(field(), { target: { value: 'Hello world typed' } })
    clickParagraph('para-000001', 5)
    openRibbonTab('Insert')
    fireEvent.click(command('Cross-reference'))
    fireEvent.click(screen.getByRole('option', { name: 'Cited paragraph' }))
    fireEvent.click(command('Insert'))
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    fireEvent.change(field(), { target: { value: 'Hello world typed more' } })
    await clickSaveAndSettle(document, 1)
    expect(document.paragraphs[0]?.runs.map((run) => run.text)).toEqual([
      'Hello',
      '',
      '',
      '',
      'Cited paragraph',
      '',
      ' world typed more',
    ])

    openRibbonTab('Home')
    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickSaveAndSettle(document, 2)
    expect(document.paragraphs[0]?.runs.map((run) => run.text)).toEqual([
      'Hello',
      '',
      '',
      '',
      'Cited paragraph',
      '',
      ' world typed',
    ])
  })

  it('reverses a run edit split by a saved page number without duplicating text', async () => {
    const document = await server(['Hello world'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph('Hello world')
    fireEvent.change(field(), { target: { value: 'Hello world typed' } })
    clickParagraph('para-000001', 5)
    openRibbonTab('Insert')
    fireEvent.click(command('Page number'))
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    fireEvent.change(field(), { target: { value: 'Hello world typed more' } })
    await clickSaveAndSettle(document, 1)
    expect(document.paragraphs[0]?.runs.map((run) => run.text)).toEqual([
      'Hello',
      '',
      '',
      '',
      '',
      '',
      ' world typed more',
    ])

    openRibbonTab('Home')
    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickSaveAndSettle(document, 2)
    expect(document.paragraphs[0]?.runs.map((run) => run.text)).toEqual([
      'Hello',
      '',
      '',
      '',
      '',
      '',
      ' world typed',
    ])
  })

  it('reverses a run edit split by a saved footnote without duplicating text', async () => {
    const document = await server(['Hello world'])
    mountWorkspace({
      editAsync: document.editAsync,
      decideAsync: document.decideAsync,
      modelFor: document.modelFor,
    })
    selectBodyParagraph('Hello world')
    fireEvent.change(field(), { target: { value: 'Hello world typed' } })
    clickParagraph('para-000001', 5)
    openRibbonTab('Insert')
    fireEvent.click(command('Footnote'))
    fireEvent.change(field(), { target: { value: 'A note' } })
    fireEvent.click(command('Close footnotes'))
    clickParagraph('para-000001')
    fireEvent.change(field(), { target: { value: 'Hello world typed more' } })
    await clickSaveAndSettle(document, 1)
    expect(document.paragraphs[0]?.runs.map((run) => run.text)).toEqual([
      'Hello',
      '',
      ' world typed more',
    ])

    openRibbonTab('Home')
    fireEvent.click(undoButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    await clickSaveAndSettle(document, 2)
    expect(document.paragraphs[0]?.runs.map((run) => run.text)).toEqual([
      'Hello',
      '',
      ' world typed',
    ])
  })
})

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

function paintedDecorations(): CSSStyleDeclaration[] {
  return [...document.querySelectorAll('[data-caret-run-overlay] span')]
    .filter((span): span is HTMLElement => span instanceof HTMLElement)
    .map((span) => span.style)
}

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function stubImagePicker() {
  const image = globalThis.Image
  const { createObjectURL, revokeObjectURL } = URL
  class StubbedImage {
    naturalWidth = 1
    naturalHeight = 1
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  Object.assign(globalThis, { Image: StubbedImage })
  Object.assign(URL, {
    createObjectURL: () => 'blob:pending-image',
    revokeObjectURL: () => undefined,
  })
  return () => {
    Object.assign(globalThis, { Image: image })
    Object.assign(URL, { createObjectURL, revokeObjectURL })
  }
}

function insertPictureFile() {
  fireEvent.click(command('Picture'))
  const input = screen.getByLabelText('Insert picture')
  const bytes = Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0))
  const file = new File([bytes], 'figure.png', { type: 'image/png' })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  fireEvent.change(input)
}
