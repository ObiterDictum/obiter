import type { DocumentModelWire } from '@obiter/contracts'
import type { LaidOutPage, LaidOutParagraph } from './document-page-blocks'
import type { StoryBlock } from './document-page-tables'
import type { FootnoteLayout } from './document-page-footnotes'
import {
  paragraphMeasure,
  paragraphLineCount,
  paragraphMeasureGeneration,
} from './document-page-measure'

export type FootnotePlacement = {
  layout: FootnoteLayout
  minimumPages: Map<string, number>
  reusable: boolean
}

type Placement = FootnotePlacement & {
  drafts: Record<string, string>
  pages: LaidOutPage[]
  generation: number
  blocks: StoryBlock[] | undefined
}

const placements = new WeakMap<DocumentModelWire, Placement>()

export function rememberFootnotePlacement(
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  pages: LaidOutPage[],
  layout: FootnoteLayout,
  minimumPages: Map<string, number>,
  blocks?: StoryBlock[],
): void {
  placements.set(model, {
    drafts: { ...drafts },
    pages,
    layout,
    minimumPages,
    generation: paragraphMeasureGeneration,
    blocks,
    reusable: true,
  })
}

export function previousFootnotePlacement(
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  blocks?: StoryBlock[],
): FootnotePlacement | undefined {
  const cached = placements.get(model)
  if (
    !cached ||
    cached.generation !== paragraphMeasureGeneration ||
    cached.blocks !== blocks ||
    model.changes.length
  )
    return
  const changed = new Set(
    Object.keys({ ...cached.drafts, ...drafts }).filter(
      (id) => cached.drafts[id] !== drafts?.[id],
    ),
  )
  if (cached.pages.some((page) => page.floats.length || page.textBoxes.length))
    return
  if (!changed.size) return cached
  for (const story of model.stories) {
    for (const paragraph of story.paragraphs) {
      if (!paragraph.runs.some((run) => changed.has(run.id))) continue
      const fragments = fragmentsOf(cached.pages, paragraph.id)
      const first = fragments[0]
      if (!first) return
      if (
        fragments.length !== 1 ||
        first.fragment.continuation ||
        first.fragment.from
      )
        return { ...cached, reusable: false }
      const before = paragraphMeasure(paragraph, model, cached.drafts, {})
      const after = paragraphMeasure(paragraph, model, drafts, {})
      const width = first.fragment.wrapWidthPx
      if (
        first.fragment.to !== before.text.length ||
        before.anchors.length ||
        before.imagePx ||
        before.pageBreaks.length ||
        !width ||
        paragraphLineCount(before, width, 0, before.textIndentPx) !==
          paragraphLineCount(after, width, 0, after.textIndentPx)
      )
        return { ...cached, reusable: false }
      for (const run of paragraph.runs) changed.delete(run.id)
      if (!changed.size) return cached
    }
  }
  return cached
}

function fragmentsOf(
  pages: LaidOutPage[],
  paragraphId: string,
): { page: number; fragment: LaidOutParagraph }[] {
  const result: { page: number; fragment: LaidOutParagraph }[] = []
  for (const [page, laidOut] of pages.entries()) {
    for (const block of laidOut.blocks) {
      if (block.type !== 'paragraph' || block.paragraph.id !== paragraphId)
        continue
      result.push({ page, fragment: block })
    }
  }
  return result
}
