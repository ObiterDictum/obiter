import { useMemo, useState } from 'react'

import {
  clampPictureSize,
  nudgedPictureSize,
  pictureResizeDraft,
  pictureSizeDraftId,
  type PictureSize,
  type PictureTarget,
} from '../../document-picture-resize'
import type { StructuralDraft } from '../../document-structural-drafts'
import { paintedPictureSize, type PictureInteraction } from './picture-frame'
import type { PictureSizeControl } from './picture-size-toolbar'
import { useLatestCallback } from './use-latest-callback'

export function usePicture({
  trackChanges,
  drafts,
}: {
  trackChanges: boolean
  drafts: {
    structures: readonly StructuralDraft[]
    setStructures: (
      update: (current: StructuralDraft[]) => StructuralDraft[],
    ) => void
  }
}) {
  const [selection, setSelection] = useState<
    (PictureTarget & { columnWidthPx: number }) | null
  >(null)
  const [lockRatio, setLockRatio] = useState(true)
  const refusal = trackChanges
    ? 'Picture size changes are not recorded as tracked changes'
    : undefined
  const resize = useLatestCallback(
    (target: PictureTarget, size: PictureSize) => {
      if (!selection || refusal) return
      drafts.setStructures((current) => [
        ...current.filter(
          (item) =>
            !(item.kind === 'image-size' && item.runId === target.runId),
        ),
        {
          id: pictureSizeDraftId(target.runId),
          kind: 'image-size',
          paragraphId: target.paragraphId,
          runId: target.runId,
          widthPx: Math.max(1, Math.round(size.widthPx)),
          heightPx: Math.max(1, Math.round(size.heightPx)),
        },
      ])
    },
  )
  const reset = useLatestCallback((target: PictureTarget) => {
    drafts.setStructures((current) =>
      current.filter(
        (item) => !(item.kind === 'image-size' && item.runId === target.runId),
      ),
    )
  })
  const select = useLatestCallback(
    (target: PictureTarget, columnWidthPx: number) =>
      setSelection({ ...target, columnWidthPx }),
  )
  const clear = useLatestCallback(() => setSelection(null))
  const nudge = useLatestCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      const frame = selection ? paintedPictureSize(selection.runId) : undefined
      if (!selection || !frame || refusal) return
      resize(
        selection,
        nudgedPictureSize(frame, direction, selection.columnWidthPx),
      )
    },
  )
  const interaction = useMemo<PictureInteraction>(
    () => ({
      selectedRunId: selection?.runId ?? null,
      lockRatio,
      unavailable: refusal,
      onSelect: select,
      onClear: clear,
      onResize: resize,
    }),
    [selection?.runId, lockRatio, refusal, select, clear, resize],
  )
  const control = useMemo<PictureSizeControl | undefined>(
    () =>
      selection
        ? {
            runId: selection.runId,
            columnWidthPx: selection.columnWidthPx,
            lockRatio,
            resized:
              pictureResizeDraft(drafts.structures, selection.runId) !==
              undefined,
            unavailable: refusal,
            onLockRatio: setLockRatio,
            onResize: (size: PictureSize) =>
              resize(
                selection,
                clampPictureSize(size, {
                  columnWidthPx: selection.columnWidthPx,
                  lockRatio,
                }),
              ),
            onReset: () => reset(selection),
          }
        : undefined,
    [selection, lockRatio, refusal, drafts.structures, resize, reset],
  )
  return {
    interaction,
    control,
    keydown: selection ? { onClear: clear, onNudge: nudge } : undefined,
  }
}
