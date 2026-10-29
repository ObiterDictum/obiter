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
  const tableCellIds = storyTableCellIds(story)
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
    if (draft.kind === 'table-of-contents') {
      changed = foldToc(paragraphs, draft, tails) || changed
      continue
    }
    if (draft.kind === 'table-of-authorities') {
      changed = foldToa.insert(paragraphs, draft, tails) || changed
      continue
    }
    if (draft.kind === 'table-of-authorities-refresh') {
      changed = foldToa.refresh(paragraphs, draft) || changed
      continue
    }
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

function paragraphWire(paraId: string): DocumentParagraphWire {
  return {
    id: `para-w14-${paraId}`,
    sourceParaId: paraId,
    runs: [],
    preservedXmlFragments: [],
  }
}

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
