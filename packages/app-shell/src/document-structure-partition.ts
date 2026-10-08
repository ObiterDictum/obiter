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

/**
 * The structural half of the save partition: every pending structure is
 * refused here for every reason the ribbon and the writer would refuse
 * it — a missing or deleted anchor, an anchor in the wrong story, a
 * conflicting pending mark, a changed marked range — so a stale draft is
 * held back with the disclosure reason rather than reaching a batch the
 * server must reject. Surviving structures join `keep.structures` in
 * order, which the mark-conflict checks read as pending state.
 */
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
  // The table-of-contents facts the shared refusal predicate reads, computed
  // lazily so a save holding no such draft does not re-parse the tables. The
  // heading set is the painted view restricted to stored paragraphs: a
  // paragraph deleted earlier in the batch is gone, and a `set_paragraph_style`
  // the same batch carries is already applied — the writer sees both when it
  // captures entries, so a freshly styled heading must count.
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
  // The table-of-authorities facts the shared refusal predicate reads,
  // computed lazily like the contents facts. A paragraph that only a
  // pending insert owns cannot carry the mark or bookmark, so it is
  // never among the scanned paragraphs.
  const tableOfAuthoritiesFacts = createTableOfAuthoritiesFacts({
    model,
    batchDeletions,
    drafts: keep.drafts,
    extraRuns: keep.extraRuns,
    paragraphStyles: state.format.paragraphStyles,
  })
  // Paragraphs a kept table-of-authorities refresh will rewrite: a
  // structure anchored inside that range would be silently replaced, so it
  // is held back rather than composed. Insert anchors are resolved lazily
  // — a save holding no refresh draft never walks the chain.
  const refreshCovered = new Set<string>()
  let insertAnchors: Set<string> | undefined
  const storyParagraphs = documentStory(model)?.paragraphs ?? []
  for (const structure of state.structures) {
    const deletedAnchor = batchDeletions.has(structure.paragraphId)
    const missingTarget =
      structure.kind === 'cross-reference' &&
      (!paragraphIds.has(structure.targetParagraphId) ||
        batchDeletions.has(structure.targetParagraphId))
    // A footnote's reference lives in the body alone: an anchor in any other
    // editable story is a placement the writer must reject, so it is blocked
    // here rather than sent to fail. A page number carries the same rule
    // against a note-story anchor — the `PAGE` field only resolves in the
    // body, a header or a footer.
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
    // Same-paragraph pairs a writer cannot compose (a link rewrites whole
    // runs; a field splice poisons its run for a second splice) are held back
    // like `replacedEmptyAnchors`, so they are disclosed rather than failing
    // the whole request.
    const wire = paragraphWires.get(structure.paragraphId)
    // A reloaded table-of-contents draft is refused for every reason the
    // ribbon would refuse the insertion now: the shared wire-level predicate
    // keeps the two surfaces from drifting, and anything it cannot see — an
    // anchor inside `w:sdt` content — stays the writer's last line.
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
    // A reloaded table-of-authorities draft is refused for every reason the
    // ribbon would refuse the insertion now — same shared-predicate
    // arrangement as the contents table — plus the mark-level conflicts the
    // ribbon cannot know: a citing paragraph whose mark offset lands inside
    // a stored `w:hyperlink` or a pending mark the field cannot compose
    // with holds the whole draft, the way the writer's refusal would.
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
    // A reloaded refresh draft is refused for every reason the ribbon
    // would refuse the update now: the field it names must still be a
    // stored `TOA` head, and nothing pending may touch the range the
    // writer rewrites. The block also catches a second refresh queued on
    // the same field.
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
            })
        : undefined
    // A structure anchored inside a field a kept refresh rewrites would be
    // silently replaced along with the generated paragraphs.
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
    // A defined-term draft's identity is the words it covered, not the
    // range: typing earlier in the paragraph can move different text under
    // the same offsets, and the writer would then mark and name words the
    // user never selected. The batch's effective text must still read
    // `marked` at `[from, to)` — the same check the writer's name
    // derivation silently depends on, made honest.
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
