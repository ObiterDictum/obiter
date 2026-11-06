import type { DocumentModelWire } from '@obiter/contracts'
import { drawingSizeSupport, setDrawingExtent } from '@obiter/ooxml'

import { drawingBoxSize } from './document-page-media'
import type { StructuralDraft } from './document-structural-drafts'

export const PICTURE_MIN_PX = 16
export const PICTURE_RESIZE_STEP_MM = 1
const PX_PER_MM = 96 / 25.4

export type PictureTarget = { paragraphId: string; runId: string }

export type PictureSize = { widthPx: number; heightPx: number }

export type PictureFrame = PictureSize & {
  xml: string
  floating: boolean
}

export type PictureResizeInput = {
  from: PictureSize
  deltaX: number
  deltaY: number
  lockRatio: boolean
  columnWidthPx: number
}

export function centimetresFromPx(px: number) {
  return px / PX_PER_MM / 10
}

export function pxFromCentimetres(centimetres: number) {
  return centimetres * 10 * PX_PER_MM
}

export function pictureSizeInCentimetres(size: PictureSize) {
  return {
    width: centimetresFromPx(size.widthPx),
    height: centimetresFromPx(size.heightPx),
  }
}

export function pictureFrameOf(
  model: DocumentModelWire | undefined,
  target: PictureTarget,
): PictureFrame | undefined {
  const paragraph = model?.stories
    .flatMap((story) => story.paragraphs)
    .find((item) => item.id === target.paragraphId)
  const run = paragraph?.runs.find((item) => item.id === target.runId)
  const xml = run?.preservedXmlFragments.find((fragment) =>
    /<w:drawing\b/i.test(fragment),
  )
  if (!xml) return undefined
  const size = drawingBoxSize(xml)
  return {
    widthPx: size.width,
    heightPx: size.height,
    xml,
    floating: drawingSizeSupport(xml) === 'floating',
  }
}

export function pictureSizeDraftId(runId: string) {
  return `picture-size:${runId}`
}

export function pictureResizeDraft(
  structures: readonly StructuralDraft[],
  runId: string,
) {
  return structures.find(
    (item): item is Extract<StructuralDraft, { kind: 'image-size' }> =>
      item.kind === 'image-size' && item.runId === runId,
  )
}

export function pictureSizeRefusal(xml: string) {
  const support = drawingSizeSupport(xml)
  if (support === 'floating') return 'A floating picture cannot be resized.'
  if (support === 'unsupported') {
    return 'Only a picture that sits in a line of text can be resized.'
  }
  return undefined
}

export function clampPictureSize(
  size: PictureSize,
  { columnWidthPx, lockRatio }: { columnWidthPx: number; lockRatio: boolean },
): PictureSize {
  const maxWidth = Math.max(PICTURE_MIN_PX, columnWidthPx)
  if (!lockRatio) {
    return {
      widthPx: Math.round(
        Math.min(maxWidth, Math.max(PICTURE_MIN_PX, size.widthPx)),
      ),
      heightPx: Math.round(Math.max(PICTURE_MIN_PX, size.heightPx)),
    }
  }
  const ratio = size.widthPx / size.heightPx
  const width = Math.min(maxWidth, Math.max(PICTURE_MIN_PX, size.widthPx))
  const height = Math.max(PICTURE_MIN_PX, width / ratio)
  return {
    widthPx: Math.round(Math.min(maxWidth, height * ratio)),
    heightPx: Math.round(height),
  }
}

export function draggedPictureSize({
  from,
  deltaX,
  deltaY,
  lockRatio,
  columnWidthPx,
}: PictureResizeInput): PictureSize {
  if (!lockRatio) {
    return clampPictureSize(
      { widthPx: from.widthPx + deltaX, heightPx: from.heightPx + deltaY },
      { columnWidthPx, lockRatio: false },
    )
  }
  const ratio = from.widthPx / from.heightPx
  const widthPx =
    Math.abs(deltaY) > Math.abs(deltaX)
      ? from.widthPx + deltaY * ratio
      : from.widthPx + deltaX
  return clampPictureSize(
    { widthPx, heightPx: widthPx / ratio },
    { columnWidthPx, lockRatio: true },
  )
}

export function nudgedPictureSize(
  from: PictureSize,
  direction: 'left' | 'right' | 'up' | 'down',
  columnWidthPx: number,
): PictureSize {
  const step = PICTURE_RESIZE_STEP_MM * PX_PER_MM
  return draggedPictureSize({
    from,
    deltaX: direction === 'left' ? -step : direction === 'right' ? step : 0,
    deltaY: direction === 'up' ? -step : direction === 'down' ? step : 0,
    lockRatio: true,
    columnWidthPx,
  })
}

export function resizedPictureXml(
  xml: string,
  size: PictureSize,
): string | undefined {
  return setDrawingExtent(xml, size)
}

export function pictureChanged(
  frame: PictureFrame | undefined,
  draft: { widthPx: number; heightPx: number } | undefined,
) {
  if (!frame || !draft) return false
  return (
    Math.round(frame.widthPx) !== Math.round(draft.widthPx) ||
    Math.round(frame.heightPx) !== Math.round(draft.heightPx)
  )
}
