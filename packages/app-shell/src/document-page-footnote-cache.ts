import type { DocumentModelWire } from '@obiter/contracts'
import type { LaidOutPage } from './document-page-blocks'
import type { StoryBlock } from './document-page-tables'
import {
  paragraphMeasure,
  paragraphLineCount,
  paragraphMeasureGeneration,
} from './document-page-measure'

type Placement = {
  drafts: Record<string, string>
  pages: LaidOutPage[]
  minimumPages: Map<string, number>
  generation: number
  blocks: StoryBlock[] | undefined
}

const placements = new WeakMap<DocumentModelWire, Placement>()

export function rememberFootnotePlacement(
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  pages: LaidOutPage[],
  minimumPages: Map<string, number>,
  blocks?: StoryBlock[],
): void {
  placements.set(model, {
    drafts: { ...drafts },
    pages,
    minimumPages,
    generation: paragraphMeasureGeneration,
    blocks,
  })
}

export function previousFootnotePlacement(
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  blocks?: StoryBlock[],
): Placement | undefined {
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
  const body = model.stories.find((story) => story.kind === 'document')
  for (const paragraph of body?.paragraphs ?? []) {
    if (!paragraph.runs.some((run) => changed.has(run.id))) continue
    const fragments = cached.pages.flatMap((page) =>
      page.blocks.flatMap((block) =>
        block.type === 'paragraph' && block.paragraph.id === paragraph.id
          ? [block]
          : [],
      ),
    )
    const fragment = fragments[0]
    if (
      fragments.length !== 1 ||
      !fragment ||
      fragment.continuation ||
      fragment.from
    )
      return
    const before = paragraphMeasure(paragraph, model, cached.drafts, {})
    const after = paragraphMeasure(paragraph, model, drafts, {})
    if (fragment.to !== before.text.length) return
    if (before.anchors.length || before.imagePx || before.pageBreaks.length)
      return
    const width = fragment.wrapWidthPx
    if (
      !width ||
      paragraphLineCount(before, width, 0, before.textIndentPx) !==
        paragraphLineCount(after, width, 0, after.textIndentPx)
    )
      return
    for (const run of paragraph.runs) changed.delete(run.id)
    if (!changed.size) return cached
  }
}
