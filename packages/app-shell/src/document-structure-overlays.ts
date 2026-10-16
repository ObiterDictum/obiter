import type { DocumentModelWire } from '@obiter/contracts'
import { documentStory, paragraphPlainText } from './document-model-text'
import type { StructuralDraft } from './document-structural-drafts'

/**
 * What the run overlay needs to paint the pending link and cross-reference
 * drafts over one paragraph. A link is a range painted on the covered text;
 * a cross-reference is a zero-width marker at its offset, labelled with the
 * target's current text so the chip reads like the resolved field without
 * entering the editable stream.
 */
export type ParagraphLinkOverlay = {
  links: Array<{ from: number; to: number; target: string }>
  fieldMarkers: Array<{ offset: number; label: string }>
}

/** The longest text a cross-reference chip or chooser row carries. */
const CROSS_REFERENCE_LABEL_MAX_LENGTH = 60

/** The label a cross-reference draft points at: the target's text, trimmed.
 * A target that is no longer in the story gets a distinct label — the chip
 * must read as unresolvable, not as pointing at a genuinely empty paragraph. */
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

/**
 * Groups the pending link and cross-reference drafts by the paragraph they
 * paint over. Ranges and offsets are in the paragraph's painted text — the
 * same coordinates the selection and the folded picture already use — so the
 * overlay aligns without remapping.
 */
export function structuralLinkOverlays(
  model: DocumentModelWire | undefined,
  structures: readonly StructuralDraft[],
): ReadonlyMap<string, ParagraphLinkOverlay> {
  const overlays = new Map<string, ParagraphLinkOverlay>()
  const entry = (paragraphId: string) => {
    const current = overlays.get(paragraphId)
    if (current) return current
    const created: ParagraphLinkOverlay = { links: [], fieldMarkers: [] }
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
