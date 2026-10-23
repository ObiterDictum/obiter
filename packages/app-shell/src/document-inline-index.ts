import type {
  DocumentChangeWire,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

const indexes = new WeakMap<
  readonly DocumentChangeWire[],
  ReturnType<typeof indexChanges>
>()
const stories = new WeakMap<
  DocumentModelWire,
  WeakMap<DocumentParagraphWire, string>
>()

function indexChanges(changes: readonly DocumentChangeWire[]) {
  const paragraphs = new Map<string, DocumentChangeWire[]>()
  for (const change of changes) {
    if (!change.paragraphId) continue
    const bucket = paragraphs.get(change.paragraphId) ?? []
    bucket.push(change)
    paragraphs.set(change.paragraphId, bucket)
  }
  return paragraphs
}

/**
 * Models and their change lists are immutable; share one index across layout
 * and paint instead of filtering every change per paragraph. Joins out of a
 * revised paragraph are refused, so no revision follows its runs into another
 * paragraph before save.
 */
export function paragraphChanges(
  paragraph: DocumentParagraphWire,
  changes: readonly DocumentChangeWire[],
  partName?: string,
) {
  let index = indexes.get(changes)
  if (!index) {
    index = indexChanges(changes)
    indexes.set(changes, index)
  }
  const bucket = index.get(paragraph.id) ?? []
  return partName
    ? bucket.filter((change) => change.storyPartName === partName)
    : bucket
}

export function paragraphPartName(
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
) {
  let index = stories.get(model)
  if (!index) {
    index = new WeakMap()
    for (const story of model.stories)
      for (const paragraph of story.paragraphs)
        index.set(paragraph, story.partName)
    stories.set(model, index)
  }
  return index.get(paragraph)
}

/** The changes a stored paragraph carries in its own story. */
export function storedParagraphChanges(
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
) {
  return paragraphChanges(
    paragraph,
    model.changes,
    paragraphPartName(model, paragraph),
  )
}

/**
 * A run-less paragraph holding revisions has no ordinary run to write into,
 * and the writer refuses to delete or replace a paragraph carrying tracked
 * markup, so it offers no editable surface until its changes are decided.
 */
export function revisionOnlyParagraph(
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
) {
  return (
    paragraph.runs.length === 0 &&
    storedParagraphChanges(model, paragraph).length > 0
  )
}
