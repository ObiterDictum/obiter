import {
  EDITABLE_STORY_KINDS,
  type DocumentChangeWire,
  type DocumentCursor,
  type DocumentModelWire,
  type DocumentParagraphWire,
  type DocumentStoryWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'

export function documentStory(
  model: DocumentModelWire,
  kind: DocumentStoryWire['kind'] = 'document',
): DocumentStoryWire | undefined {
  return model.stories.find((story) => story.kind === kind)
}

export function editableStories(model: DocumentModelWire): DocumentStoryWire[] {
  return model.stories.filter((story) => EDITABLE_STORY_KINDS.has(story.kind))
}

/** The editable story — body, margin or notes — `paragraphId` belongs to. */
export function editableStoryOf(
  model: DocumentModelWire,
  paragraphId: string,
): DocumentStoryWire | undefined {
  return editableStories(model).find((story) =>
    story.paragraphs.some((paragraph) => paragraph.id === paragraphId),
  )
}

/** `paragraphId`'s wire in whichever editable story owns it. */
export function editableParagraph(
  model: DocumentModelWire,
  paragraphId: string,
): DocumentParagraphWire | undefined {
  return editableStoryOf(model, paragraphId)?.paragraphs.find(
    (paragraph) => paragraph.id === paragraphId,
  )
}

/** Every paragraph across the editable stories, in story order. */
export function editableParagraphs(model: DocumentModelWire) {
  return editableStories(model).flatMap((story) => story.paragraphs)
}

export function paragraphPlainText(
  paragraph: DocumentParagraphWire,
  drafts?: Record<string, string>,
): string {
  return paragraph.runs.map((run) => drafts?.[run.id] ?? run.text).join('')
}

/**
 * The paragraph the layout, caret and save paths read: the stored runs plus
 * runs an edit holds outside them (`extraRuns`, which a join stores so the
 * saved operation keeps its original run ids), with text drafts applied.
 *
 * A draft replaces one whole run. This must see that run before range
 * emphasis slices it: the slice that keeps the original id would otherwise
 * become the entire draft, and the later slices would be appended after it.
 * Returns the same paragraph when nothing textual changes, so a pagination
 * pass does not rebuild every paragraph's runs.
 */
export function effectiveParagraph(
  paragraph: DocumentParagraphWire,
  drafts: Record<string, string> | undefined,
  extraRuns: readonly DocumentTextRunWire[] = [],
): DocumentParagraphWire {
  if (extraRuns.length === 0 && !drafts) return paragraph
  const runs =
    extraRuns.length === 0 ? paragraph.runs : [...paragraph.runs, ...extraRuns]
  let changed = extraRuns.length > 0
  const next = runs.map((run) => {
    const text = drafts?.[run.id] ?? run.text
    if (text === run.text) return run
    changed = true
    return { ...run, text }
  })
  if (!changed) return paragraph
  return { ...paragraph, runs: next }
}

export function paragraphRunStart(
  paragraph: DocumentParagraphWire,
  runId: string,
  drafts?: Record<string, string>,
): number {
  let cursor = 0
  for (const run of paragraph.runs) {
    if (run.id === runId) return cursor
    cursor += (drafts?.[run.id] ?? run.text).length
  }
  return 0
}

export function deleteCharBeforeOffset(
  paragraph: DocumentParagraphWire,
  drafts: Record<string, string> | undefined,
  offset: number,
): { runId: string; text: string } | undefined {
  if (offset <= 0) return undefined
  const index = offset - 1
  let cursor = 0
  for (const run of paragraph.runs) {
    const text = drafts?.[run.id] ?? run.text
    if (index < cursor + text.length) {
      const at = index - cursor
      return { runId: run.id, text: text.slice(0, at) + text.slice(at + 1) }
    }
    cursor += text.length
  }
  return undefined
}

export function spliceRunSlice(
  runText: string,
  runStart: number,
  from: number,
  to: number,
  slice: string,
): string {
  const fromInRun = Math.max(0, from - runStart)
  const toInRun = Math.min(runText.length, Math.max(0, to - runStart))
  return runText.slice(0, fromInRun) + slice + runText.slice(toInRun)
}

export type TextDiff = {
  from: number
  to: number
  insert: string
}

export function textDiff(previous: string, next: string): TextDiff {
  let start = 0
  const limit = Math.min(previous.length, next.length)
  while (start < limit && previous[start] === next[start]) start += 1
  let endPrev = previous.length
  let endNext = next.length
  while (
    endPrev > start &&
    endNext > start &&
    previous[endPrev - 1] === next[endNext - 1]
  ) {
    endPrev -= 1
    endNext -= 1
  }
  return { from: start, to: endPrev, insert: next.slice(start, endNext) }
}

export function sliceContainsOffset(
  offset: number,
  from: number,
  to: number,
  fullLength: number,
): boolean {
  if (offset < from) return false
  if (offset < to) return true
  return to === fullLength && offset >= to
}

/**
 * A slice of one run, carrying the paragraph-model offset it starts at. The
 * renderer needs `from` to decide which part of the run a document selection
 * covers, which a bare text slice cannot answer on its own.
 */
export type RunSlice = {
  run: DocumentTextRunWire
  text: string
  from: number
}

export function sliceParagraphRuns(
  paragraph: DocumentParagraphWire,
  from: number,
  to: number,
  drafts?: Record<string, string>,
): RunSlice[] {
  const slices: RunSlice[] = []
  let cursor = 0
  for (const run of paragraph.runs) {
    const text = drafts?.[run.id] ?? run.text
    const start = cursor
    const end = cursor + text.length
    cursor = end
    if (end <= from || start >= to) continue
    const sliceFrom = start + Math.max(0, from - start)
    slices.push({
      run,
      text: text.slice(Math.max(0, from - start), Math.max(0, to - start)),
      from: sliceFrom,
    })
  }
  return slices
}

export function modelPlainText(model: DocumentModelWire): string {
  const story = documentStory(model)
  if (!story) return ''
  return story.paragraphs
    .map((paragraph) => paragraphPlainText(paragraph))
    .join('\n')
}

export function runChangeKinds(
  changes: DocumentChangeWire[],
  runId: string,
): Set<DocumentChangeWire['kind']> {
  const kinds = new Set<DocumentChangeWire['kind']>()
  for (const change of changes) {
    if (change.runId === runId) kinds.add(change.kind)
  }
  return kinds
}

export function paragraphHasUnmodelled(
  paragraph: DocumentParagraphWire,
): boolean {
  return (
    paragraph.preservedXmlFragments.length > 0 ||
    paragraph.runs.some((run) => run.preservedXmlFragments.length > 0)
  )
}

export function storyHasUnmodelled(story: DocumentStoryWire): boolean {
  return (
    story.preservedXmlFragments.length > 0 ||
    story.paragraphs.some(paragraphHasUnmodelled)
  )
}

export function runDraftKey(run: DocumentTextRunWire): string {
  return run.id
}

export function cursorForSelection(
  model: DocumentModelWire,
  paragraphId: string,
): DocumentCursor | null {
  const paragraph = editableParagraph(model, paragraphId)
  const run = paragraph?.runs[0]
  if (!paragraph || !run) return null
  return { paragraphId: paragraph.id, runId: run.id, offset: 0 }
}

/**
 * Resolves a paragraph id to the story that paints it, indexed once over the
 * whole model: the body answers for ids no margin or note story claims, so a
 * lookup stays O(1) instead of walking every story per paragraph.
 */
export function paragraphStoryResolver(model: DocumentModelWire) {
  const storyByParagraph = new Map<string, { kind: string; partName: string }>()
  let bodyStory = { kind: 'document', partName: '' }
  for (const item of model.stories) {
    if (item.kind === 'document') {
      bodyStory = { kind: 'document', partName: item.partName }
      continue
    }
    for (const paragraph of item.paragraphs) {
      storyByParagraph.set(paragraph.id, {
        kind: item.kind,
        partName: item.partName,
      })
    }
  }
  return (paragraphId: string) => storyByParagraph.get(paragraphId) ?? bodyStory
}
