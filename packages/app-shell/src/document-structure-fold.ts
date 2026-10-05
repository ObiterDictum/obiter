import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import {
  buildInlineDrawingXml,
  buildTableXml,
  IMAGE_RELATIONSHIP_TYPE,
} from '@obiter/ooxml'
import { storyTableCellIds } from './document-page-tables'
import {
  pendingImageTarget,
  type StructuralDraft,
} from './document-structural-drafts'

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
 *
 * Both fragments come from the same `structure-xml` builders the writers
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

  const stories = model.stories.map((story) => {
    if (story.kind !== 'document') return story
    const result = foldStory(story, active, drafts, nextParaId, (draft) => {
      const relId = nextRelId()
      relationships.push({
        sourcePartName: story.partName,
        id: relId,
        type: IMAGE_RELATIONSHIP_TYPE,
        target: pendingImageTarget(draft),
        sourceFragment: `<Relationship Id="${relId}" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="${pendingImageTarget(draft)}"/>`,
      })
      return relId
    })
    changed ||= result.changed
    return result.story
  })
  if (!changed) return model
  return { ...model, stories, relationships }
}

const emptyDeleted: ReadonlySet<string> = new Set()

function foldStory(
  story: DocumentStoryWire,
  structures: readonly StructuralDraft[],
  drafts: Record<string, string>,
  nextParaId: () => string,
  nextRelationshipId: (draft: StructuralDraft & { kind: 'image' }) => string,
) {
  const paragraphs = [...story.paragraphs]
  const fragments = [...story.preservedXmlFragments]
  // Which wires belong to an existing table is decided by the one binding
  // `storyBlocks` computes — the same binding the paint and the ribbon read —
  // so a paraId-less stored table's cells are found by position exactly as
  // the writer finds the sibling `w:tbl`. Pending cell wires join the set as
  // they fold, so a later anchor can also see a not-yet-saved table.
  const tableCellIds = storyTableCellIds(story)
  // Per-anchor chaining mirrors the writer's `tableTailWires`: the next table
  // at one anchor splices after the previous table's last cell, and the
  // separator paragraph keeps adjacent tables from merging.
  const tails = new Map<string, DocumentParagraphWire>()
  const occurrences = new Map<string, number>()
  let changed = false

  for (const draft of structures) {
    if (draft.kind === 'table') {
      const anchor = tailAnchor(paragraphs, draft.paragraphId, tails)
      if (!anchor) continue
      const occurrence = occurrences.get(draft.paragraphId) ?? 0
      occurrences.set(draft.paragraphId, occurrence + 1)
      const cellParaIds = Array.from(
        { length: draft.rows * draft.columns },
        () => nextParaId(),
      )
      const wires: DocumentParagraphWire[] = []
      if (occurrence > 0) wires.push(paragraphWire(nextParaId()))
      wires.push(...cellParaIds.map(paragraphWire))
      const index = paragraphs.indexOf(anchor)
      paragraphs.splice(index + 1, 0, ...wires)
      // A table at the story's end, or directly before another table, needs
      // the trailing paragraph the writer adds — a `w:tbl` cannot be a body's
      // last child, and two adjacent tables merge.
      const after = paragraphs[index + 1 + wires.length]
      if (!after || tableCellIds.has(after.id)) {
        paragraphs.splice(
          index + 1 + wires.length,
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

function tailAnchor(
  paragraphs: DocumentParagraphWire[],
  paragraphId: string,
  tails: ReadonlyMap<string, DocumentParagraphWire>,
) {
  return (
    tails.get(paragraphId) ??
    paragraphs.find((paragraph) => paragraph.id === paragraphId)
  )
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
  const runs = [...paragraph.runs]
  let cursor = 0
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]
    if (!run) break
    const effective = drafts[run.id] ?? run.text
    if (effective.length === 0) continue
    const end = cursor + effective.length
    if (draft.offset <= cursor) {
      runs.splice(index, 0, drawingRun)
      return { ...paragraph, runs }
    }
    if (draft.offset < end) {
      const within = draft.offset - cursor
      const drafted = drafts[run.id] !== undefined
      const head: DocumentTextRunWire = {
        ...run,
        ...(drafted ? { id: `${draft.id}:head` } : {}),
        text: effective.slice(0, within),
      }
      const tail: DocumentTextRunWire = {
        ...run,
        id: `${draft.id}:tail`,
        text: effective.slice(within),
        preservedXmlFragments: run.preservedXmlFragments.filter((fragment) =>
          /^<w:rPr\b/u.test(fragment),
        ),
      }
      runs.splice(index, 1, head, drawingRun, tail)
      return { ...paragraph, runs }
    }
    cursor = end
  }
  runs.push(drawingRun)
  return { ...paragraph, runs }
}

export { pendingImagePartName } from './document-structural-drafts'
