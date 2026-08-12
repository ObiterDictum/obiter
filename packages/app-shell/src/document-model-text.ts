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

export function paragraphPlainText(paragraph: DocumentParagraphWire): string {
  return paragraph.runs.map((run) => run.text).join('')
}

export function modelPlainText(model: DocumentModelWire): string {
  const story = documentStory(model)
  if (!story) return ''
  return story.paragraphs.map(paragraphPlainText).join('\n')
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
