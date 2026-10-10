import { parseDocx } from '../../packages/ooxml/src/parse'
import { paragraphOutlineLevel } from '../../packages/ooxml/src/table-of-contents-entries'

/**
 * An OOXML-level semantic summary of an exported package: the counts and text
 * that say what survived the round-trip. Deliberately not a visual claim —
 * what Word renders is an operator observation, not a field here.
 */
export type Summary = {
  bodyText: string
  paragraphs: number
  headings: number
  sectionBreaks: number
  storyKinds: string[]
  fields: number
  styles: number
  numberingInstances: number
  imageRelationships: number
  comments: number
  trackedChanges: number
  footnotes: number
  endnotes: number
  opaqueParts: number
}

export async function summarise(bytes: Uint8Array): Promise<Summary> {
  const doc = await parseDocx(bytes)
  const model = doc.model
  const storyKinds = model.stories.map((story) => story.kind).sort()
  const documentStory = model.stories.find((story) => story.kind === 'document')
  const textOf = (story: typeof documentStory) =>
    (story?.paragraphs ?? [])
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
      .join('\n')
  const count = (kind: string) =>
    model.stories.filter((story) => story.kind === kind).length
  const sectionBreaks = (documentStory?.paragraphs ?? []).filter((paragraph) =>
    paragraph.preservedXmlFragments.some((fragment) =>
      fragment.includes('<w:sectPr'),
    ),
  ).length
  return {
    bodyText: textOf(documentStory).replaceAll(/\s+/g, ' ').trim(),
    paragraphs: documentStory?.paragraphs.length ?? 0,
    headings: (documentStory?.paragraphs ?? []).filter(
      (paragraph) =>
        paragraphOutlineLevel(paragraph, model.styles) !== undefined,
    ).length,
    sectionBreaks,
    storyKinds,
    fields: model.stories.reduce(
      (sum, story) => sum + (story.fields?.length ?? 0),
      0,
    ),
    styles: model.styles.length,
    numberingInstances: model.numbering.length,
    imageRelationships: model.relationships.filter((rel) =>
      rel.type.endsWith('/image'),
    ).length,
    comments: model.comments.length,
    trackedChanges: model.changes.length,
    footnotes: count('footnotes'),
    endnotes: count('endnotes'),
    // The package parts preserved byte-for-byte through the pipeline; a drop
    // means the round-trip ate something it could not model.
    opaqueParts: doc.sourceParts.size,
  }
}

export function compare(first: Summary, second: Summary) {
  const checks: { name: string; pass: boolean; detail: string }[] = []
  const push = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail })
  push(
    'body text identical',
    first.bodyText === second.bodyText,
    first.bodyText === second.bodyText
      ? `${String(first.bodyText.length)} chars match`
      : `cycle 1: "${first.bodyText.slice(0, 80)}…" vs cycle 2: "${second.bodyText.slice(0, 80)}…"`,
  )
  push(
    'body paragraph count',
    first.paragraphs === second.paragraphs,
    `${String(first.paragraphs)} vs ${String(second.paragraphs)}`,
  )
  push(
    'story kinds preserved',
    JSON.stringify(first.storyKinds) === JSON.stringify(second.storyKinds),
    first.storyKinds.join(', '),
  )
  for (const key of [
    'headings',
    'sectionBreaks',
    'fields',
    'styles',
    'numberingInstances',
    'imageRelationships',
    'comments',
    'trackedChanges',
    'footnotes',
    'endnotes',
    'opaqueParts',
  ] as const) {
    push(
      key,
      first[key] === second[key],
      `${String(first[key])} vs ${String(second[key])}`,
    )
  }
  return checks
}
