import { describe, expect, it } from 'bun:test'
import {
  applyDocumentEdits,
  buildInlineDrawingXml,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'

import { emptyDraftState, planDocumentSave } from './document-save-plan'
import type { DocumentModelWire } from '@obiter/contracts'
import { documentStory } from './document-model-text'
import { withStructuralDrafts } from './document-structure-fold'
import {
  centimetresFromPx,
  clampPictureSize,
  draggedPictureSize,
  nudgedPictureSize,
  PICTURE_MIN_PX,
  pictureResizeDraft,
  pictureSizeRefusal,
  pxFromCentimetres,
  pictureSizeDraftId,
  resizedPictureXml,
} from './document-picture-resize'
import type { StructuralDraft } from './document-structural-drafts'

const COLUMN_WIDTH = 500

const inlineDrawing = () =>
  buildInlineDrawingXml({
    widthPx: 200,
    heightPx: 100,
    relId: 'rId2',
    name: 'Figure 1',
    docPrId: 7,
  })

describe('picture size arithmetic', () => {
  it('keeps the aspect ratio when a corner is dragged with the ratio locked', () => {
    const size = draggedPictureSize({
      from: { widthPx: 200, heightPx: 100 },
      deltaX: 50,
      deltaY: 0,
      lockRatio: true,
      columnWidthPx: COLUMN_WIDTH,
    })
    expect(size).toEqual({ widthPx: 250, heightPx: 125 })
  })

  it('resizes both dimensions freely when the ratio is unlocked', () => {
    const size = draggedPictureSize({
      from: { widthPx: 200, heightPx: 100 },
      deltaX: 40,
      deltaY: 60,
      lockRatio: false,
      columnWidthPx: COLUMN_WIDTH,
    })
    expect(size).toEqual({ widthPx: 240, heightPx: 160 })
  })

  it('lets a mostly vertical drag drive the size when the ratio is locked', () => {
    const size = draggedPictureSize({
      from: { widthPx: 200, heightPx: 100 },
      deltaX: 4,
      deltaY: 30,
      lockRatio: true,
      columnWidthPx: COLUMN_WIDTH,
    })
    expect(size).toEqual({ widthPx: 260, heightPx: 130 })
  })

  it('never widens a picture past the text column', () => {
    const size = draggedPictureSize({
      from: { widthPx: 400, heightPx: 200 },
      deltaX: 400,
      deltaY: 0,
      lockRatio: true,
      columnWidthPx: COLUMN_WIDTH,
    })
    expect(size).toEqual({ widthPx: COLUMN_WIDTH, heightPx: 250 })
  })

  it('never narrows a picture below the minimum in either direction', () => {
    const size = draggedPictureSize({
      from: { widthPx: 200, heightPx: 100 },
      deltaX: -400,
      deltaY: 0,
      lockRatio: true,
      columnWidthPx: COLUMN_WIDTH,
    })
    expect(size).toEqual({
      widthPx: PICTURE_MIN_PX * 2,
      heightPx: PICTURE_MIN_PX,
    })
    expect(
      clampPictureSize(size, { columnWidthPx: COLUMN_WIDTH, lockRatio: true }),
    ).toEqual(size)
  })

  it('holds both edges of a free resize inside the minimum and the column', () => {
    expect(
      clampPictureSize(
        { widthPx: 900, heightPx: 4 },
        { columnWidthPx: COLUMN_WIDTH, lockRatio: false },
      ),
    ).toEqual({ widthPx: COLUMN_WIDTH, heightPx: PICTURE_MIN_PX })
    expect(
      clampPictureSize(
        { widthPx: 4, heightPx: 900 },
        { columnWidthPx: COLUMN_WIDTH, lockRatio: false },
      ),
    ).toEqual({ widthPx: PICTURE_MIN_PX, heightPx: 900 })
  })

  it('steps a shift-arrow nudge by one millimetre and keeps the ratio', () => {
    const wider = nudgedPictureSize(
      { widthPx: 200, heightPx: 100 },
      'right',
      COLUMN_WIDTH,
    )
    expect(wider).toEqual({ widthPx: 204, heightPx: 102 })
    const narrower = nudgedPictureSize(wider, 'left', COLUMN_WIDTH)
    expect(narrower).toEqual({ widthPx: 200, heightPx: 100 })
    const taller = nudgedPictureSize(
      { widthPx: 200, heightPx: 100 },
      'down',
      COLUMN_WIDTH,
    )
    expect(taller).toEqual({ widthPx: 208, heightPx: 104 })
    const shorter = nudgedPictureSize(taller, 'up', COLUMN_WIDTH)
    expect(shorter).toEqual({ widthPx: 200, heightPx: 100 })
  })

  it('reports centimetres to two decimal places from stored pixels', () => {
    expect(centimetresFromPx(pxFromCentimetres(5))).toBeCloseTo(5, 6)
    expect(centimetresFromPx(96)).toBeCloseTo(2.54, 6)
  })

  it('writes a resizeable drawing and refuses a floating one', () => {
    const resized = resizedPictureXml(inlineDrawing(), {
      widthPx: 300,
      heightPx: 150,
    })
    expect(resized).toContain('cx="2857500" cy="1428750"')
    const floating = inlineDrawing()
      .replace('<wp:inline ', '<wp:anchor ')
      .replace('</wp:inline>', '</wp:anchor>')
    expect(pictureSizeRefusal(floating)).toBe(
      'A floating picture cannot be resized.',
    )
    expect(pictureSizeRefusal(inlineDrawing())).toBeUndefined()
  })

  it('finds the pending size draft for a picture run', () => {
    const structures: StructuralDraft[] = [
      {
        id: 'picture-size:run_1',
        kind: 'image-size',
        paragraphId: 'para_1',
        runId: 'run_1',
        widthPx: 300,
        heightPx: 150,
      },
    ]
    expect(pictureResizeDraft(structures, 'run_1')?.widthPx).toBe(300)
    expect(pictureResizeDraft(structures, 'run_2')).toBeUndefined()
  })
})

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function savedPictureModel() {
  const document = await parseDocx(await createSyntheticDocx(['Body text']))
  const anchor = documentStory(document.model)?.paragraphs[0]
  if (!anchor) throw new Error('Fixture paragraph is missing.')
  applyDocumentEdits(document, [
    {
      type: 'insert_image',
      paragraphId: anchor.id,
      offset: 0,
      contentType: 'image/png',
      dataBase64: PNG_BASE64,
      widthPx: 200,
      heightPx: 100,
      name: 'Figure',
    },
  ])
  const reloaded = await parseDocx(await serialiseDocx(document))
  const paragraph = documentStory(reloaded.model)?.paragraphs[0]
  const run = paragraph?.runs.find((item) =>
    item.preservedXmlFragments.some((fragment) =>
      fragment.includes('<w:drawing'),
    ),
  )
  if (!(paragraph && run)) throw new Error('Fixture picture is missing.')
  const size: StructuralDraft = {
    id: pictureSizeDraftId(run.id),
    kind: 'image-size',
    paragraphId: paragraph.id,
    runId: run.id,
    widthPx: 300,
    heightPx: 150,
  }
  return { model: reloaded.model, size }
}

describe('a queued picture size change', () => {
  it('paints the new extent before the document is saved', async () => {
    const { model, size } = await savedPictureModel()
    const drawing = (source: DocumentModelWire) =>
      documentStory(source)
        ?.paragraphs[0]?.runs.flatMap((run) => run.preservedXmlFragments)
        .join('') ?? ''
    expect(drawing(withStructuralDrafts(model, [size]))).toContain(
      'cx="2857500" cy="1428750"',
    )
    expect(drawing(model)).toContain('cx="1905000" cy="952500"')
  })

  it('saves as a picture size operation and is dropped once tracked changes is on', async () => {
    const { model, size } = await savedPictureModel()
    const state = { ...emptyDraftState(), structures: [size] }
    expect(planDocumentSave(model, state).operations).toEqual([
      {
        type: 'set_image_size',
        runId: size.runId,
        widthPx: 300,
        heightPx: 150,
      },
    ])
    const tracked = planDocumentSave(model, state, true)
    expect(tracked.operations).toEqual([])
    expect(tracked.blocked.map((item) => item.reason)).toEqual([
      'Picture size changes are not recorded as tracked changes',
    ])
  })
})
