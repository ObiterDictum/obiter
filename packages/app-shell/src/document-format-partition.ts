import type {
  BlockedDraft,
  DraftSlot,
  DraftState,
} from './document-draft-state'
import { sectionDraftFields } from './document-section-format'
import type { LocalInsert } from './document-story-flow'

export function partitionFormatDrafts(
  state: DraftState,
  paragraphIds: ReadonlySet<string>,
  insertById: ReadonlyMap<string, LocalInsert>,
  keep: DraftState,
  pendingCellIds: ReadonlySet<string> = new Set(),
) {
  const covered: DraftSlot[] = []
  const blocked: BlockedDraft[] = []
  const pending = (paragraphId: string) =>
    paragraphIds.has(paragraphId) ||
    insertById.has(paragraphId) ||
    pendingCellIds.has(paragraphId)

  for (const [paragraphId, styleId] of Object.entries(
    state.format.paragraphStyles,
  )) {
    if (pending(paragraphId)) {
      keep.format.paragraphStyles[paragraphId] = styleId
      covered.push({
        kind: 'paragraph-style',
        key: `style:${paragraphId}`,
        paragraphId,
      })
      continue
    }
    blocked.push({
      slot: {
        kind: 'paragraph-style',
        key: `style:${paragraphId}`,
        paragraphId,
      },
      reason: 'This paragraph is no longer in the document.',
      label: 'a paragraph style',
    })
  }

  for (const [paragraphId, numbering] of Object.entries(
    state.format.numbering,
  )) {
    if (pending(paragraphId)) {
      keep.format.numbering[paragraphId] = numbering
      covered.push({
        kind: 'numbering',
        key: `number:${paragraphId}`,
        paragraphId,
      })
      continue
    }
    blocked.push({
      slot: { kind: 'numbering', key: `number:${paragraphId}`, paragraphId },
      reason: 'This paragraph is no longer in the document.',
      label: 'list formatting',
    })
  }

  for (const [paragraphId, paragraphFormat] of Object.entries(
    state.format.paragraphFormats,
  )) {
    if (pending(paragraphId)) {
      keep.format.paragraphFormats[paragraphId] = paragraphFormat
      covered.push({
        kind: 'paragraph-format',
        key: `pformat:${paragraphId}`,
        paragraphId,
      })
      continue
    }
    blocked.push({
      slot: {
        kind: 'paragraph-format',
        key: `pformat:${paragraphId}`,
        paragraphId,
      },
      reason: 'This paragraph is no longer in the document.',
      label: 'paragraph formatting',
    })
  }

  if (sectionDraftFields(state.format.section)) {
    keep.format.section = state.format.section
    covered.push({ kind: 'section', key: 'section' })
  }

  return { covered, blocked }
}
