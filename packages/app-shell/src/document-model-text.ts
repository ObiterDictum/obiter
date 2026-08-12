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
