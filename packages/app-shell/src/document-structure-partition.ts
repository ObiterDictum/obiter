import {
  PAGE_STORY_KINDS,
  type DocumentModelWire,
  type DocumentParagraphWire,
  type DocumentStoryKind,
} from '@obiter/contracts'

import {
  documentStory,
  effectiveParagraph,
  paragraphPlainText,
} from './document-model-text'
import type {
  BlockedDraft,
  DraftSlot,
  DraftState,
} from './document-draft-state'
import { storyTableCellIds } from './document-page-tables'
import { slotLabel } from './document-save-slots'
import {
  conflictingStructure,
  structuralKindNoun,
} from './document-structure-conflicts'
import { resolveInsertAnchor } from './document-story-flow'
import {
  isTableOfContentsHeading,
  tableOfContentsAnchorBlock,
  tableOfContentsHeadingsBlock,
} from './document-toc-availability'
import {
  createTableOfAuthoritiesFacts,
  tableOfAuthoritiesPartitionBlock,
  tableOfAuthoritiesUpdateBlock,
} from './document-toa-availability'

export function partitionStructureSlots({
  model,
  state,
  paragraphIds,
  batchDeletions,
  paragraphStoryKind,
  paragraphWires,
  keep,
  covered,
  blocked,
  blockedStructureReasons,
}: {
  model: DocumentModelWire
  state: DraftState
  paragraphIds: ReadonlySet<string>
  batchDeletions: ReadonlySet<string>
  paragraphStoryKind: ReadonlyMap<string, DocumentStoryKind>
  paragraphWires: ReadonlyMap<string, DocumentParagraphWire>
  keep: DraftState
  covered: DraftSlot[]
  blocked: BlockedDraft[]
  blockedStructureReasons: Map<string, string>
}) {
  let tocFacts:
    | { cellIds: ReadonlySet<string>; headings: DocumentParagraphWire[] }
    | undefined
  const tableOfContentsFacts = () => {
    const story = documentStory(model)
    tocFacts ??= {
      cellIds: storyTableCellIds(story),
      headings: (story?.paragraphs ?? []).filter((paragraph) => {
        if (batchDeletions.has(paragraph.id)) return false
        const pendingStyle = state.format.paragraphStyles[paragraph.id]
        const effective = { ...paragraph }
        if (pendingStyle === null) delete effective.styleId
        else if (pendingStyle !== undefined) effective.styleId = pendingStyle
        return isTableOfContentsHeading(effective, model.styles)
      }),
    }
    return tocFacts
  }
  const tableOfAuthoritiesFacts = createTableOfAuthoritiesFacts({
    model,
    batchDeletions,
    drafts: keep.drafts,
    extraRuns: keep.extraRuns,
    paragraphStyles: state.format.paragraphStyles,
  })
  const refreshCovered = new Set<string>()
  let insertAnchors: Set<string> | undefined
  const storyParagraphs = documentStory(model)?.paragraphs ?? []
  for (const structure of state.structures) {
    const deletedAnchor = batchDeletions.has(structure.paragraphId)
    const missingTarget =
      structure.kind === 'cross-reference' &&
      (!paragraphIds.has(structure.targetParagraphId) ||
        batchDeletions.has(structure.targetParagraphId))
    const anchorStoryKind = paragraphStoryKind.get(structure.paragraphId)
    const nonBodyAnchor =
      (structure.kind === 'footnote' ||
        structure.kind === 'table-of-contents' ||
        structure.kind === 'table-of-authorities' ||
        structure.kind === 'table-of-authorities-refresh' ||
        structure.kind === 'defined-term') &&
      anchorStoryKind !== undefined &&
      anchorStoryKind !== 'document'
    const nonPageAnchor =
      structure.kind === 'page-number' &&
      anchorStoryKind !== undefined &&
      !PAGE_STORY_KINDS.has(anchorStoryKind)
    const wire = paragraphWires.get(structure.paragraphId)
    const tableOfContentsBlock =
      structure.kind === 'table-of-contents' && wire !== undefined
        ? (tableOfContentsAnchorBlock(
            wire,
            tableOfContentsFacts().cellIds,
            model.changes,
          ) ??
          tableOfContentsHeadingsBlock(
            tableOfContentsFacts().headings,
            model.changes,
          ))
        : undefined
    const tableOfAuthoritiesBlock =
      structure.kind === 'table-of-authorities' && wire !== undefined
        ? tableOfAuthoritiesPartitionBlock({
            wire,
            cellParagraphIds: tableOfContentsFacts().cellIds,
            changes: model.changes,
            facts: tableOfAuthoritiesFacts,
            drafts: keep.drafts,
            extraRuns: keep.extraRuns,
            structures: keep.structures,
          })
        : undefined
    const refreshField =
      structure.kind === 'table-of-authorities-refresh'
        ? tableOfAuthoritiesFacts().fields.get(structure.paragraphId)
        : undefined
    if (refreshField && insertAnchors === undefined) {
      const insertById = new Map(
        state.inserts.map((item) => [item.clientId, item]),
      )
      insertAnchors = new Set(
        keep.inserts.map((insert) =>
          resolveInsertAnchor(insert, insertById, paragraphIds),
        ),
      )
    }
    const refreshBlock =
      structure.kind === 'table-of-authorities-refresh'
        ? refreshField === undefined
          ? 'The table of authorities this updates is no longer in the document.'
          : tableOfAuthoritiesUpdateBlock({
              field: refreshField,
              fieldWires: refreshField.paragraphIds.flatMap((id) => {
                const found = storyParagraphs.find(
                  (paragraph) => paragraph.id === id,
                )
                return found === undefined ? [] : [found]
              }),
              facts: tableOfAuthoritiesFacts(),
              changes: model.changes,
              deletions: batchDeletions,
              drafts: keep.drafts,
              extraRuns: keep.extraRuns,
              format: state.format,
              breaks: state.breaks,
              insertAnchors: insertAnchors ?? new Set(),
              structures: keep.structures,
              queuedRefresh:
                refreshField !== undefined &&
                keep.structures.some(
                  (item) =>
                    item.kind === 'table-of-authorities-refresh' &&
                    item.paragraphId === refreshField.headId,
                ),
            })
        : undefined
    const coveredByRefresh =
      refreshCovered.has(structure.paragraphId) ||
      (structure.kind === 'cross-reference' &&
        refreshCovered.has(structure.targetParagraphId))
    const conflicting = wire
      ? conflictingStructure(
          wire,
          keep.drafts,
          keep.extraRuns[structure.paragraphId] ?? [],
          keep.structures,
          structure,
        )
      : undefined
    const definedTermDrift =
      structure.kind === 'defined-term' &&
      wire !== undefined &&
      paragraphPlainText(
        effectiveParagraph(
          wire,
          keep.drafts,
          keep.extraRuns[structure.paragraphId] ?? [],
        ),
      ).slice(structure.from, structure.to) !== structure.marked
    if (
      !paragraphIds.has(structure.paragraphId) ||
      deletedAnchor ||
      missingTarget ||
      nonBodyAnchor ||
      nonPageAnchor ||
      tableOfContentsBlock ||
      tableOfAuthoritiesBlock ||
      refreshBlock ||
      coveredByRefresh ||
      conflicting ||
      definedTermDrift
    ) {
      const reason = nonBodyAnchor
        ? structure.kind === 'table-of-contents'
          ? 'A table of contents can only be placed in the body.'
          : structure.kind === 'table-of-authorities'
            ? 'A table of authorities can only be placed in the body.'
            : structure.kind === 'table-of-authorities-refresh'
              ? 'A table of authorities update can only target the body.'
              : structure.kind === 'defined-term'
                ? 'A defined-term mark can only be placed in the body.'
                : 'A footnote can only be placed in the body.'
        : nonPageAnchor
          ? 'A page number needs a page of its own: the body, a header or a footer.'
          : missingTarget
            ? 'The paragraph this references is no longer in the document.'
            : deletedAnchor
              ? 'The paragraph this was placed after is marked for deletion.'
              : coveredByRefresh
                ? 'This is inside a table of authorities that is already queued to update.'
                : (tableOfContentsBlock ??
                  tableOfAuthoritiesBlock ??
                  refreshBlock ??
                  (definedTermDrift
                    ? 'The text under this defined-term mark changed since it was marked.'
                    : conflicting
                      ? `The paragraph already holds a ${structuralKindNoun(conflicting.kind)} this cannot be combined with.`
                      : 'The paragraph this was placed in is no longer in the document.'))
      blockedStructureReasons.set(structure.id, reason)
      blocked.push({
        slot: {
          kind: 'structure',
          key: `structure:${structure.id}`,
          id: structure.id,
          structureKind: structure.kind,
        },
        reason,
        label: slotLabel({
          kind: 'structure',
          key: `structure:${structure.id}`,
          id: structure.id,
          structureKind: structure.kind,
        }),
      })
      continue
    }
    keep.structures.push(structure)
    if (structure.kind === 'table-of-authorities-refresh' && refreshField) {
      for (const id of refreshField.resultIds) refreshCovered.add(id)
    }
    covered.push({
      kind: 'structure',
      key: `structure:${structure.id}`,
      id: structure.id,
      structureKind: structure.kind,
    })
  }
}
