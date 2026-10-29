import type { DocumentModelWire } from '@obiter/contracts'
import { documentStory, paragraphPlainText } from './document-model-text'
import type { StructuralDraft } from './document-structural-drafts'

export type ParagraphLinkOverlay = {
  links: Array<{ from: number; to: number; target: string }>
  marks: Array<{ from: number; to: number }>
  fieldMarkers: Array<{ offset: number; label: string }>
}

const CROSS_REFERENCE_LABEL_MAX_LENGTH = 60

export function crossReferenceTargetLabel(
  model: DocumentModelWire | undefined,
  targetParagraphId: string,
): string {
  const paragraph = (model ? documentStory(model)?.paragraphs : [])?.find(
    (item) => item.id === targetParagraphId,
  )
  if (!paragraph) return '(target no longer in the document)'
  const text = paragraphPlainText(paragraph).trim()
  if (text.length === 0) return '(empty paragraph)'
  return text.length > CROSS_REFERENCE_LABEL_MAX_LENGTH
    ? `${text.slice(0, CROSS_REFERENCE_LABEL_MAX_LENGTH).trimEnd()}…`
    : text
}

export function structuralLinkOverlays(
  model: DocumentModelWire | undefined,
  structures: readonly StructuralDraft[],
): ReadonlyMap<string, ParagraphLinkOverlay> {
  const overlays = new Map<string, ParagraphLinkOverlay>()
  const entry = (paragraphId: string) => {
    const current = overlays.get(paragraphId)
    if (current) return current
    const created: ParagraphLinkOverlay = {
      links: [],
      marks: [],
      fieldMarkers: [],
    }
    overlays.set(paragraphId, created)
    return created
  }
  for (const structure of structures) {
    if (structure.kind === 'link') {
      entry(structure.paragraphId).links.push({
        from: structure.from,
        to: structure.to,
        target: structure.target,
      })
      continue
    }
    if (structure.kind === 'defined-term') {
      entry(structure.paragraphId).marks.push({
        from: structure.from,
        to: structure.to,
      })
      continue
    }
    if (structure.kind === 'cross-reference') {
      entry(structure.paragraphId).fieldMarkers.push({
        offset: structure.offset,
        label: crossReferenceTargetLabel(model, structure.targetParagraphId),
      })
      continue
    }
    if (structure.kind === 'page-number') {
      entry(structure.paragraphId).fieldMarkers.push({
        offset: structure.offset,
        label: 'Page number',
      })
    }
  }
  return overlays
}
