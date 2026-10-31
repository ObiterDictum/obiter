import { memo, type ComponentProps } from 'react'
import { ModelParagraphInner } from './model-paragraph'

type ModelParagraphProps = ComponentProps<typeof ModelParagraphInner>

function pageReferencesEqual(
  prev: ReadonlyMap<string, number> | undefined,
  next: ReadonlyMap<string, number> | undefined,
): boolean {
  if (prev === next) return true
  if ((prev?.size ?? 0) === 0 && (next?.size ?? 0) === 0) return true
  if ((prev?.size ?? 0) !== (next?.size ?? 0)) return false
  for (const [key, value] of prev ?? []) {
    if (next?.get(key) !== value) return false
  }
  return true
}

function imageUrlsEqual(
  prev: Record<string, string>,
  next: Record<string, string>,
): boolean {
  if (prev === next) return true
  const prevKeys = Object.keys(prev)
  const nextKeys = Object.keys(next)
  if (prevKeys.length !== nextKeys.length) return false
  for (const key of prevKeys) {
    if (prev[key] !== next[key]) return false
  }
  return true
}

function modelParagraphPropsEqual(
  prev: ModelParagraphProps,
  next: ModelParagraphProps,
): boolean {
  if (prev.selected || next.selected) return false
  return (
    prev.paragraph === next.paragraph &&
    prev.changes === next.changes &&
    prev.pendingChanges === next.pendingChanges &&
    prev.emphasis === next.emphasis &&
    prev.editing === next.editing &&
    prev.presence === next.presence &&
    prev.currentUserId === next.currentUserId &&
    prev.storyPartName === next.storyPartName &&
    prev.relationships === next.relationships &&
    imageUrlsEqual(prev.imageUrls, next.imageUrls) &&
    prev.styles === next.styles &&
    prev.from === next.from &&
    prev.to === next.to &&
    prev.padLeftPx === next.padLeftPx &&
    prev.padRightPx === next.padRightPx &&
    prev.wrapWidthPx === next.wrapWidthPx &&
    prev.continuation === next.continuation &&
    prev.pageStart === next.pageStart &&
    prev.pageNumber === next.pageNumber &&
    prev.selectionSegment === next.selectionSegment &&
    prev.listMarker === next.listMarker &&
    prev.noteMark === next.noteMark &&
    prev.noteKind === next.noteKind &&
    prev.story === next.story &&
    prev.linkOverlay === next.linkOverlay &&
    pageReferencesEqual(prev.pageReferences, next.pageReferences)
  )
}

export const ModelParagraph = memo(
  ModelParagraphInner,
  modelParagraphPropsEqual,
)
