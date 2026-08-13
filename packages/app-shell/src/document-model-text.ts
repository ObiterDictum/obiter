import type {
  DocumentChangeWire,
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

export function documentStory(
  model: DocumentModelWire,
  kind: DocumentStoryWire['kind'] = 'document',
): DocumentStoryWire | undefined {
  return model.stories.find((story) => story.kind === kind)
}

export function paragraphPlainText(
  paragraph: DocumentParagraphWire,
  drafts?: Record<string, string>,
): string {
  return paragraph.runs.map((run) => drafts?.[run.id] ?? run.text).join('')
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

export function textDiff(
  previous: string,
  next: string,
): { from: number; to: number; insert: string } {
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
  return offset === to && to === fullLength
}

export function sliceParagraphRuns(
  paragraph: DocumentParagraphWire,
  from: number,
  to: number,
  drafts?: Record<string, string>,
): Array<{ run: DocumentTextRunWire; text: string }> {
  const slices: Array<{ run: DocumentTextRunWire; text: string }> = []
  let cursor = 0
  for (const run of paragraph.runs) {
    const text = drafts?.[run.id] ?? run.text
    const start = cursor
    const end = cursor + text.length
    cursor = end
    if (end <= from || start >= to) continue
    slices.push({
      run,
      text: text.slice(Math.max(0, from - start), Math.max(0, to - start)),
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
