import '@obiter/test-dom'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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
import {
  command,
  commandOrNull,
  mountWorkspace,
} from './docx-workspace-harness'
import { openRibbonTab, setTrackChanges } from './editor-test-commands'
import { clickParagraph } from './paragraph-selection-harness'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const PICTURE_WIDTH_PX = 300
const PICTURE_HEIGHT_PX = 200

function stubImagePicker() {
  const image = globalThis.Image
  const { createObjectURL, revokeObjectURL } = URL
  class StubbedImage {
    naturalWidth = PICTURE_WIDTH_PX
    naturalHeight = PICTURE_HEIGHT_PX
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

type PersistedParagraph = { runs: Array<{ text: string }> }

async function storedPicture(initial: readonly string[]) {
  const document = await parseDocx(await createSyntheticDocx(initial))
  const anchor = document.model.stories.find(
    (story) => story.kind === 'document',
  )?.paragraphs[0]
  if (!anchor) throw new Error('The fixture paragraph is missing.')
  applyDocumentEdits(document, [
    {
      type: 'insert_image',
      paragraphId: anchor.id,
      offset: 0,
      contentType: 'image/png',
      dataBase64: PNG_BASE64,
      widthPx: PICTURE_WIDTH_PX,
      heightPx: PICTURE_HEIGHT_PX,
      name: 'Figure',
    },
  ])
  return serialiseDocx(document)
}

function toPersisted(model: DocumentModelWire): PersistedParagraph[] {
  const story = model.stories.find((item) => item.kind === 'document')
  return (story?.paragraphs ?? []).map((item) => ({
    runs: item.runs.map((run) => ({ text: run.text })),
  }))
}

async function server(initial: readonly string[]) {
  let bytes = await storedPicture(initial)
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
      const document = await parseDocx(bytes)
      applyTrackedChangeDecisions(
        document,
        input.changeIds,
        input.action,
        input.removeParagraphIds,
      )
      if (input.trackRevisions !== undefined) {
        writeTrackRevisions(document, input.trackRevisions)
      }
      const nextVersion = version + 1
      bytes = await serialiseDocx(document)
      version = nextVersion
      parsed = await parseDocx(bytes)
      paragraphs = toPersisted(parsed.model)
      return {
        documentId: 'doc_1',
        versionId: `ver_${String(version)}`,
        versionNumber: version,
        lineage: buildVersionLineage({
          recorder: createLineageRecorder(parsed.model),
          model: parsed.model,
          canonicalParagraphIds: new Map(),
          baseVersionId: input.baseVersionId,
          versionId: `ver_${String(nextVersion)}`,
          runAddressesReliable: true,
        }),
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

type Server = Awaited<ReturnType<typeof server>>

function saveButton() {
  return command('Save')
}

function saveState() {
  return document
    .querySelector('[data-save-state]')
    ?.getAttribute('data-save-state')
}

async function clickSaveAndSettle(target: Server, calls: number) {
  fireEvent.click(saveButton())
  await waitFor(() => expect(target.editAsync).toHaveBeenCalledTimes(calls))
  await target.waitForSave()
}

function picture() {
  const node = document.querySelector('[data-picture-run-id]')
  if (!(node instanceof HTMLElement)) throw new Error('The picture is missing.')
  return node
}

function pictureWidth() {
  return Math.round(Number.parseFloat(picture().style.width))
}

function handle(corner: 'nw' | 'ne' | 'sw' | 'se') {
  const node = document.querySelector(`[data-picture-handle="${corner}"]`)
  if (!(node instanceof HTMLElement)) {
    throw new Error(`The ${corner} handle is missing.`)
  }
  return node
}

function drag(
  corner: 'nw' | 'ne' | 'sw' | 'se',
  deltaX: number,
  deltaY: number,
  { shift = false }: { shift?: boolean } = {},
) {
  fireEvent.pointerDown(handle(corner), {
    clientX: 400,
    clientY: 300,
    shiftKey: shift,
  })
  fireEvent.pointerMove(window, {
    clientX: 400 + deltaX,
    clientY: 300 + deltaY,
    shiftKey: shift,
  })
  fireEvent.pointerUp(window, { clientX: 400 + deltaX, clientY: 300 + deltaY })
}

async function selectPicture() {
  fireEvent.click(picture())
  await waitFor(() =>
    expect(picture().getAttribute('data-picture-selected')).toBe('true'),
  )
}

async function insertPictureAndSelect() {
  clickParagraph('para-000001', 4)
  openRibbonTab('Insert')
  insertPictureFile()
  await waitFor(() =>
    expect(document.querySelectorAll('[data-picture-run-id]')).toHaveLength(2),
  )
  const pending = [...document.querySelectorAll('[data-picture-run-id]')][1]
  if (!(pending instanceof HTMLElement)) throw new Error('No pending picture.')
  fireEvent.click(pending)
  await waitFor(() =>
    expect(pending.getAttribute('data-picture-selected')).toBe('true'),
  )
}

function sizesIn(operations: DocumentEditOperation[]) {
  return operations.filter(
    (
      operation,
    ): operation is Extract<
      DocumentEditOperation,
      { type: 'set_image_size' }
    > => operation.type === 'set_image_size',
  )
}

describe('resizing a picture that has not been saved yet', () => {
  it('carries the dragged size into the picture insertion', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await insertPictureAndSelect()
      drag('se', 60, 0)
      await waitFor(() =>
        expect(
          Math.round(
            Number.parseFloat(
              document.querySelectorAll<HTMLElement>('[data-picture-run-id]')[1]
                ?.style.width ?? '0',
            ),
          ),
        ).toBe(360),
      )
      await clickSaveAndSettle(target, 1)
      const operations = target.editAsync.mock.calls[0]?.[0].operations ?? []
      expect(sizesIn(operations)).toEqual([])
      expect(
        operations.filter((operation) => operation.type === 'insert_image'),
      ).toEqual([expect.objectContaining({ widthPx: 360, heightPx: 240 })])
    } finally {
      restorePicker()
    }
  })
})

describe('selecting a picture', () => {
  it('selects a clicked picture, outlines it and shows four corner handles', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      expect(
        [...document.querySelectorAll('[data-picture-handle]')].map((node) =>
          node.getAttribute('data-picture-handle'),
        ),
      ).toEqual(['nw', 'ne', 'sw', 'se'])
      expect(
        screen.queryByRole('group', { name: 'Picture size' }),
      ).not.toBeNull()
    } finally {
      restorePicker()
    }
  })

  it('drops the selection on Escape and on a click in the text', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      fireEvent.keyDown(picture(), { key: 'Escape' })
      await waitFor(() =>
        expect(picture().getAttribute('data-picture-selected')).toBeNull(),
      )
      expect(document.querySelectorAll('[data-picture-handle]')).toHaveLength(0)
      expect(screen.queryByRole('group', { name: 'Picture size' })).toBeNull()

      await selectPicture()
      clickParagraph('para-000001', 2)
      await waitFor(() =>
        expect(picture().getAttribute('data-picture-selected')).toBeNull(),
      )
      expect(screen.queryByRole('group', { name: 'Picture size' })).toBeNull()
    } finally {
      restorePicker()
    }
  })
})

describe('dragging a picture handle', () => {
  it('resizes the picture by the dragged distance with the ratio locked', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      drag('se', 40, 0)
      await waitFor(() => expect(pictureWidth()).toBe(340))

      await clickSaveAndSettle(target, 1)
      expect(
        sizesIn(target.editAsync.mock.calls[0]?.[0].operations ?? []),
      ).toEqual([expect.objectContaining({ widthPx: 340, heightPx: 227 })])
    } finally {
      restorePicker()
    }
  })

  it('resizes freely when the drag holds shift', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      drag('se', 40, 60, { shift: true })
      await waitFor(() => expect(pictureWidth()).toBe(340))
      await clickSaveAndSettle(target, 1)
      expect(
        sizesIn(target.editAsync.mock.calls[0]?.[0].operations ?? []),
      ).toEqual([expect.objectContaining({ widthPx: 340, heightPx: 260 })])
    } finally {
      restorePicker()
    }
  })

  it('stops a drag at the text column width', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      const maxWidth = Number(picture().dataset.pictureMaxWidthPx)
      expect(maxWidth).toBeGreaterThan(PICTURE_WIDTH_PX)
      drag('se', 4000, 0)
      await waitFor(() => expect(pictureWidth()).toBe(maxWidth))
    } finally {
      restorePicker()
    }
  })

  it('stops a drag at the smallest allowed picture', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      drag('se', -4000, 0)
      await waitFor(() => expect(pictureWidth()).toBe(24))
    } finally {
      restorePicker()
    }
  })
})

describe('the picture size control', () => {
  it('shows the current size in centimetres and applies a typed width', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      const width = screen.getByLabelText('Picture width in centimetres')
      const height = screen.getByLabelText('Picture height in centimetres')
      expect(width).toHaveProperty('value', '7.94')
      expect(height).toHaveProperty('value', '5.29')
      expect(screen.getByLabelText('Lock aspect ratio')).toHaveProperty(
        'checked',
        true,
      )

      fireEvent.change(width, { target: { value: '6' } })
      fireEvent.blur(width, { target: { value: '6' } })
      await waitFor(() => expect(pictureWidth()).toBe(227))
      await clickSaveAndSettle(target, 1)
      expect(
        sizesIn(target.editAsync.mock.calls[0]?.[0].operations ?? []),
      ).toEqual([expect.objectContaining({ widthPx: 227, heightPx: 151 })])
    } finally {
      restorePicker()
    }
  })

  it('resets a resized picture to the size it was saved at', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      drag('se', 40, 0)
      await waitFor(() => expect(pictureWidth()).toBe(340))
      fireEvent.click(
        screen.getByRole('button', { name: 'Reset to original size' }),
      )
      await waitFor(() => expect(pictureWidth()).toBe(PICTURE_WIDTH_PX))
      expect(
        screen.getByRole('button', { name: 'Reset to original size' }),
      ).toHaveProperty('disabled', true)
    } finally {
      restorePicker()
    }
  })

  it('refuses to resize under tracked changes and says why', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      setTrackChanges(true)
      await waitFor(() =>
        expect(
          screen.getByText(
            'Picture size changes are not recorded as tracked changes',
          ),
        ).toBeDefined(),
      )
      expect(
        screen.getByLabelText('Picture width in centimetres'),
      ).toHaveProperty('disabled', true)
      drag('se', 40, 0)
      await waitFor(() => expect(pictureWidth()).toBe(PICTURE_WIDTH_PX))
    } finally {
      restorePicker()
    }
  })
})

describe('saving a picture resize', () => {
  it('saves the new size and keeps undo working across the save', async () => {
    const target = await server(['Page body'])
    mountWorkspace({
      editAsync: target.editAsync,
      decideAsync: target.decideAsync,
      modelFor: target.modelFor,
    })
    await selectPicture()
    drag('se', 40, 0)
    await waitFor(() => expect(pictureWidth()).toBe(340))

    await clickSaveAndSettle(target, 1)
    await waitFor(() => expect(saveState()).toBe('saved'))
    const operations = target.editAsync.mock.calls[0]?.[0].operations ?? []
    expect(sizesIn(operations)).toEqual([
      expect.objectContaining({ widthPx: 340, heightPx: 227 }),
    ])

    openRibbonTab('Home')
    fireEvent.click(command('Undo'))
    await waitFor(() => expect(pictureWidth()).toBe(PICTURE_WIDTH_PX))
    expect(saveState()).toBe('unsaved')
  })
})

describe('undo across a picture resize', () => {
  it('restores the earlier size with undo and the new size with redo', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      drag('se', 40, 0)
      await waitFor(() => expect(pictureWidth()).toBe(340))

      openRibbonTab('Home')
      fireEvent.click(command('Undo'))
      await waitFor(() => expect(pictureWidth()).toBe(PICTURE_WIDTH_PX))
      fireEvent.click(command('Redo'))
      await waitFor(() => expect(pictureWidth()).toBe(340))
      expect(commandOrNull('Reload')).toBeNull()
      expect(saveState()).toBe('unsaved')
    } finally {
      restorePicker()
    }
  })

  it('nudges the selected picture by a millimetre with shift and an arrow', async () => {
    const restorePicker = stubImagePicker()
    try {
      const target = await server(['Page body'])
      mountWorkspace({
        editAsync: target.editAsync,
        decideAsync: target.decideAsync,
        modelFor: target.modelFor,
      })
      await selectPicture()
      fireEvent.keyDown(picture(), { key: 'ArrowRight', shiftKey: true })
      await waitFor(() => expect(pictureWidth()).toBe(304))
      fireEvent.keyDown(picture(), { key: 'ArrowLeft', shiftKey: true })
      await waitFor(() => expect(pictureWidth()).toBe(PICTURE_WIDTH_PX))
    } finally {
      restorePicker()
    }
  })
})
