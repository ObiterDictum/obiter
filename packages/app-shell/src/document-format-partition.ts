import type {
  BlockedDraft,
  DraftSlot,
  DraftState,
} from './document-draft-state'
import { sectionDraftFields } from './document-section-format'
import type { LocalInsert } from './document-story-flow'

/**
 * Partitions the format draft fields — paragraph styles, numbering, paragraph
 * formats and the section descriptor — against the addressable paragraph set.
 *
 * All three per-paragraph maps share one rule: an entry the model names is
 * kept, an entry keyed to a pending insert is composable only when the
 * operation it produces can ride on the insert (a style can; numbering and
 * paragraph format cannot), and anything else is blocked so a stale key
 * cannot poison the request. The kept fields are written into `keep.format`;
 * the returned slots join the partition's covered and blocked lists.
 */
export function partitionFormatDrafts(
  state: DraftState,
  paragraphIds: ReadonlySet<string>,
  insertById: ReadonlyMap<string, LocalInsert>,
  keep: DraftState,
) {
  const covered: DraftSlot[] = []
  const blocked: BlockedDraft[] = []

  for (const [paragraphId, styleId] of Object.entries(
    state.format.paragraphStyles,
  )) {
    if (paragraphIds.has(paragraphId) || insertById.has(paragraphId)) {
      // A pending insert carries its own paragraph style: the insert
      // operation sets it, so no separate address is needed.
      // collectEditOperations folds this entry into the insert and omits it
      // from collectFormatOperations. It is still a covered slot so a
      // successful save clears it with the insert.
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
    if (paragraphIds.has(paragraphId)) {
      keep.format.numbering[paragraphId] = numbering
      covered.push({
        kind: 'numbering',
        key: `number:${paragraphId}`,
        paragraphId,
      })
      continue
    }
    // Numbering is a separate operation with no paragraph id of its own until
    // the insert has run, so it cannot be composed onto the insert.
    const onInsert = insertById.has(paragraphId)
    blocked.push({
      slot: { kind: 'numbering', key: `number:${paragraphId}`, paragraphId },
      reason: onInsert
        ? 'List formatting on a paragraph that has not been saved yet cannot be sent separately.'
        : 'This paragraph is no longer in the document.',
      label: onInsert
        ? 'list formatting on a new paragraph'
        : 'list formatting',
    })
  }

  for (const [paragraphId, paragraphFormat] of Object.entries(
    state.format.paragraphFormats,
  )) {
    if (paragraphIds.has(paragraphId)) {
      keep.format.paragraphFormats[paragraphId] = paragraphFormat
      covered.push({
        kind: 'paragraph-format',
        key: `pformat:${paragraphId}`,
        paragraphId,
      })
      continue
    }
    // Paragraph layout is a separate operation with no paragraph id of its
    // own until the insert has run, so it cannot be composed onto the insert.
    const onInsert = insertById.has(paragraphId)
    blocked.push({
      slot: {
        kind: 'paragraph-format',
        key: `pformat:${paragraphId}`,
        paragraphId,
      },
      reason: onInsert
        ? 'Paragraph formatting on a paragraph that has not been saved yet cannot be sent separately.'
        : 'This paragraph is no longer in the document.',
      label: onInsert
        ? 'paragraph formatting on a new paragraph'
        : 'paragraph formatting',
    })
  }

  if (sectionDraftFields(state.format.section)) {
    keep.format.section = state.format.section
    covered.push({ kind: 'section', key: 'section' })
  }

  return { covered, blocked }
}
