import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import {
  buildInlineDrawingXml,
  buildTableXml,
  decideTablePlacement,
  IMAGE_RELATIONSHIP_TYPE,
} from '@obiter/ooxml'
import { storyTableCellIds } from './document-page-tables'
import { foldFootnoteDrafts, spliceRunAtOffset } from './document-footnote-fold'
import { pendingImageTarget } from './document-image-inserts'
import type { StructuralDraft } from './document-structural-drafts'
import { createTableOfAuthoritiesFold } from './document-toa-fold'
import { createTableOfContentsFold } from './document-toc-fold'

/**
 * Folds pending table and image drafts into a copy of the model, mutating the
 * wire model exactly as the save writers mutate it:
 *
 * - A table splices one empty paragraph wire per cell after its anchor — each
 *   carrying the `w14:paraId` the fragment names — pushes the `w:tbl` fragment
 *   onto the story's preserved fragments, and adds the separator or trailing
 *   paragraph the writer emits at a body boundary. `storyBlocks` then binds
 *   the cells by id and lays the table out through the same `PageTable` path a
 *   reloaded document paints with.
 * - An image splices a zero-length run carrying the `w:drawing` fragment into
 *   its paragraph's runs at the caret offset and adds the relationship the
 *   reader resolves, so `paragraphImageXml` and `PageDrawing` paint it through
 *   the same code as a stored picture. The bytes surface through
 *   `pendingImageUrls`, keyed by the part name the folded relationship
 *   resolves to.
 * - A table of contents splits its anchor wire at the offset, splices one
 *   entry wire per heading between the head and a tail that opens with the
 *   field's `end` run, and stamps `_Toc` bookmark fragments on the heading
 *   wires, so `PAGEREF` fields resolve pending entries through the same
 *   bookmark→page map a reloaded document uses.
 * - A table of authorities runs the same splice with a heading wire plus
 *   one entry per distinct citation, and folds the hidden `TA` mark runs
 *   and `_ToA` bookmark fragments into the citing wires — the mark and
 *   bookmark pass the writer makes before it writes the field.
 *
 * All fragments come from the same `structure-xml` builders the writers
 * call, so the pending model holds the writer's own output — only the
 * server-allocated ids differ on reload.
 */
export function withStructuralDrafts(
  model: DocumentModelWire,
  structures: readonly StructuralDraft[],
  drafts: Record<string, string> = {},
  deletedIds: ReadonlySet<string> = emptyDeleted,
): DocumentModelWire {
  const active = structures.filter(
    (structure) => !deletedIds.has(structure.paragraphId),
  )
  if (active.length === 0) return model
  let changed = false
  const relationships = [...model.relationships]
  const usedParaIds = new Set(
    model.stories.flatMap((story) => [
      ...story.paragraphs.map((paragraph) => paragraph.sourceParaId ?? ''),
      ...story.preservedXmlFragments.flatMap((fragment) =>
        [...fragment.matchAll(/w14:paraId="([^"]+)"/gu)].map(
          (match) => match[1] ?? '',
        ),
      ),
    ]),
  )
  const usedRelIds = new Set(model.relationships.map((wire) => wire.id))
  let paraSequence = 1
  const nextParaId = () => {
    for (;;) {
      // `D6`-prefixed ids cannot collide with a stored `E6` writer id, and
      // the scan keeps them distinct from every paraId the package carries.
      const candidate = `D6${paraSequence.toString(16).toUpperCase().padStart(6, '0')}`
      paraSequence += 1
      if (!usedParaIds.has(candidate)) {
        usedParaIds.add(candidate)
        return candidate
      }
    }
  }
  let relSequence = 1
  const nextRelId = () => {
    for (;;) {
      const candidate = `obiterPending${String(relSequence)}`
      relSequence += 1
      if (!usedRelIds.has(candidate)) {
        usedRelIds.add(candidate)
        return candidate
      }
    }
  }

  const foldToc = createTableOfContentsFold(
    model,
    drafts,
    deletedIds,
    nextParaId,
  )
  const foldToa = createTableOfAuthoritiesFold(
    model,
    drafts,
    deletedIds,
    nextParaId,
  )
  const stories = model.stories.map((story) => {
    if (story.kind !== 'document') return story
    const result = foldStory(
      story,
      active,
      drafts,
      nextParaId,
      (draft) => {
        const relId = nextRelId()
        relationships.push({
          sourcePartName: story.partName,
          id: relId,
          type: IMAGE_RELATIONSHIP_TYPE,
          target: pendingImageTarget(draft),
          sourceFragment: `<Relationship Id="${relId}" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="${pendingImageTarget(draft)}"/>`,
        })
        return relId
      },
      foldToc,
      foldToa,
    )
    changed ||= result.changed
    return result.story
  })
  if (!changed && active.every((structure) => structure.kind !== 'footnote')) {
    return model
  }
  const withBodyFolds = { ...model, stories, relationships }
  const folded = foldFootnoteDrafts(
    withBodyFolds,
    active.filter((structure) => structure.kind === 'footnote'),
    drafts,
    nextParaId,
  )
  if (folded === withBodyFolds) return changed ? withBodyFolds : model
  return folded
}

const emptyDeleted: ReadonlySet<string> = new Set()

function foldStory(
  story: DocumentStoryWire,
  structures: readonly StructuralDraft[],
  drafts: Record<string, string>,
  nextParaId: () => string,
  nextRelationshipId: (draft: StructuralDraft & { kind: 'image' }) => string,
  foldToc: (
    paragraphs: DocumentParagraphWire[],
    draft: StructuralDraft & { kind: 'table-of-contents' },
    tails: Map<string, DocumentParagraphWire>,
  ) => boolean,
  foldToa: {
    insert: (
      paragraphs: DocumentParagraphWire[],
      draft: StructuralDraft & { kind: 'table-of-authorities' },
      tails: Map<string, DocumentParagraphWire>,
    ) => boolean
    refresh: (
      paragraphs: DocumentParagraphWire[],
      draft: StructuralDraft & { kind: 'table-of-authorities-refresh' },
    ) => boolean
  },
) {
  const paragraphs = [...story.paragraphs]
  const fragments = [...story.preservedXmlFragments]
  // Which wires belong to an existing table is decided by the one binding
  // `storyBlocks` computes — the same binding the paint and the ribbon read —
  // so a paraId-less stored table's cells are found by position exactly as
  // the writer finds the sibling `w:tbl`. Pending cell wires join the set as
  // they fold, so a later anchor can also see a not-yet-saved table.
  const tableCellIds = storyTableCellIds(story)
  // The parked tail per anchor — the wire the writer's `postAnchorTails`
  // records — so the placement descriptor reads the same neighbourhood.
  const tails = new Map<string, DocumentParagraphWire>()
  const occurrences = new Map<string, number>()
  let changed = false

  for (const draft of structures) {
    if (draft.kind === 'table') {
      const anchorWire = paragraphs.find(
        (paragraph) => paragraph.id === draft.paragraphId,
      )
      if (!anchorWire) continue
      const pendingTail = tails.get(draft.paragraphId)
      // The neighbourhood is read behind the parked tail — the position the
      // writer's zero-width splices land at — so the shared rule decides from
      // the same facts on both sides. A body `w:sectPr` is not a wire, so the
      // story's end already reports no following block.
      const probe = pendingTail ?? anchorWire
      const index = paragraphs.indexOf(probe)
      const following = paragraphs[index + 1]
      const occurrence = occurrences.get(draft.paragraphId) ?? 0
      occurrences.set(draft.paragraphId, occurrence + 1)
      const placement = decideTablePlacement({
        hasPendingTail: pendingTail !== undefined,
        hasFollowingBlock: following !== undefined,
        followingIsTable:
          following !== undefined && tableCellIds.has(following.id),
        followingIsSectionProperties: false,
        occurrence,
      })
      const anchor =
        placement.chainAfterPendingTail && pendingTail
          ? pendingTail
          : anchorWire
      const cellParaIds = Array.from(
        { length: draft.rows * draft.columns },
        () => nextParaId(),
      )
      const wires: DocumentParagraphWire[] = []
      if (placement.needsSeparatorParagraph) {
        wires.push(paragraphWire(nextParaId()))
      }
      wires.push(...cellParaIds.map(paragraphWire))
      const spliceAt = paragraphs.indexOf(anchor)
      paragraphs.splice(spliceAt + 1, 0, ...wires)
      if (placement.needsTrailingParagraph) {
        paragraphs.splice(
          spliceAt + 1 + wires.length,
          0,
          paragraphWire(nextParaId()),
        )
      }
      for (const id of cellParaIds) tableCellIds.add(`para-w14-${id}`)
      fragments.push(buildTableXml(draft.rows, draft.columns, cellParaIds))
      tails.set(draft.paragraphId, wires[wires.length - 1] ?? anchor)
      changed = true
      continue
    }
    // A table of contents splices its field and entry wires into the story
    // exactly as the writer splices the field and entry paragraphs — same
    // head/entry/tail shape, painted through the same `PAGEREF` resolution.
    if (draft.kind === 'table-of-contents') {
      changed = foldToc(paragraphs, draft, tails) || changed
      continue
    }
    // A table of authorities folds the same way: the mark and bookmark
    // pass first, then the field's heading, entry and tail wires.
    if (draft.kind === 'table-of-authorities') {
      changed = foldToa.insert(paragraphs, draft, tails) || changed
      continue
    }
    // A table of authorities refresh rewrites the stored field's
    // generated paragraphs in place — the same mark, bookmark and entry
    // wires, minus the tail split the insertion performs.
    if (draft.kind === 'table-of-authorities-refresh') {
      changed = foldToa.refresh(paragraphs, draft) || changed
      continue
    }
    // A link or cross-reference folds nothing into the model: the link is an
    // overlay range and the field paints as a zero-width marker, both read
    // straight from the draft state by `structuralLinkOverlays`.
    if (draft.kind !== 'image') continue
    const paragraph = paragraphs.find((item) => item.id === draft.paragraphId)
    if (!paragraph) continue
    const relId = nextRelationshipId(draft)
    const drawingXml = buildInlineDrawingXml({
      widthPx: draft.widthPx,
      heightPx: draft.heightPx,
      relId,
      name: draft.name,
      docPrId: 900_000_001,
    })
    const folded = spliceDrawingRun(paragraph, draft, drawingXml, drafts)
    paragraphs.splice(paragraphs.indexOf(paragraph), 1, folded)
    changed = true
  }
  return {
    story: changed
      ? { ...story, paragraphs, preservedXmlFragments: fragments }
      : story,
    changed,
  }
}

/** The wire a freshly minted empty paragraph carries — what a reparse reads. */
function paragraphWire(paraId: string): DocumentParagraphWire {
  return {
    id: `para-w14-${paraId}`,
    sourceParaId: paraId,
    runs: [],
    preservedXmlFragments: [],
  }
}

/**
 * Splices the drawing run into the paragraph wire at the effective-text
 * offset, splitting the run that contains it — the wire counterpart of the
 * writer's `spliceInlineXml` + `spliceRunWires`.
 *
 * The offset addresses effective text (typed drafts included), exactly as the
 * writer's whole-run replacement composes the drawing into the pending text.
 * A run the draft state replaces wholesale splits the same way, but neither
 * half can keep the run's id: the drafts map would repaint the full
 * replacement text on whichever half kept it.
 */
function spliceDrawingRun(
  paragraph: DocumentParagraphWire,
  draft: StructuralDraft & { kind: 'image' },
  drawingXml: string,
  drafts: Record<string, string>,
): DocumentParagraphWire {
  const drawingRun: DocumentTextRunWire = {
    id: `${draft.id}:drawing`,
    text: '',
    preservedXmlFragments: [drawingXml],
  }
  return spliceRunAtOffset(
    paragraph,
    draft.offset,
    drawingRun,
    drafts,
    `${draft.id}:drawing`,
  )
}

export { pendingImagePartName } from './document-image-inserts'
