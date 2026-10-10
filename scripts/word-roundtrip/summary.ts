import type { DocumentRelationshipWire } from '../../packages/contracts/src/document-model'
import type { SourcePartRole } from '../../packages/ooxml/src/model'
import { parseDocx } from '../../packages/ooxml/src/parse'
import { resolveRelationshipTarget } from '../../packages/ooxml/src/parts/rels'
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
  /**
   * Every package part with the role the parser gave it — the identities the
   * preservation check diffs. A bare count cannot tell a dropped part from
   * an added one, and a producer's own metadata parts (docProps/app.xml is
   * the Word evidence this harness requires) are additions to record, not
   * failures.
   */
  packageParts: { name: string; role: SourcePartRole }[]
  /**
   * Every relationship's semantic binding — source part, type, resolved
   * target and external flag. The relationship id is deliberately absent:
   * producers renumber ids on save, and the binding is the identity, not
   * its numbering.
   */
  relationships: string[]
}

/**
 * The document story's text, whitespace-normalised. The word-step's
 * relatedness check compares this against the cycle-1 export: a file with
 * different body text is a different document, however it was produced.
 */
export function documentBodyText(
  doc: Awaited<ReturnType<typeof parseDocx>>,
): string {
  const story = doc.model.stories.find((item) => item.kind === 'document')
  return (story?.paragraphs ?? [])
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

function relationshipEntry(rel: DocumentRelationshipWire): string {
  const external = rel.targetMode?.toLowerCase() === 'external'
  // Internal targets normalise to their part name so equivalent spellings
  // compare equal. A target that will not resolve keeps its raw spelling:
  // the entry's job is identity, and the raw spelling is still that.
  let target = rel.target
  if (!external) {
    try {
      const resolved = resolveRelationshipTarget(rel)
      if (resolved) target = resolved
    } catch {
      target = rel.target
    }
  }
  const source = rel.sourcePartName || '(package)'
  return `${source} :: ${rel.type} -> ${target}${external ? ' [external]' : ''}`
}

export async function summarise(bytes: Uint8Array): Promise<Summary> {
  const doc = await parseDocx(bytes)
  const model = doc.model
  const storyKinds = model.stories.map((story) => story.kind).sort()
  const documentStory = model.stories.find((story) => story.kind === 'document')
  const count = (kind: string) =>
    model.stories.filter((story) => story.kind === kind).length
  const sectionBreaks = (documentStory?.paragraphs ?? []).filter((paragraph) =>
    paragraph.preservedXmlFragments.some((fragment) =>
      fragment.includes('<w:sectPr'),
    ),
  ).length
  return {
    bodyText: documentBodyText(doc),
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
    packageParts: [...doc.sourceParts.values()]
      .map((part) => ({ name: part.name, role: part.role }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    relationships: model.relationships.map(relationshipEntry).sort(),
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
  ] as const) {
    push(
      key,
      first[key] === second[key],
      `${String(first[key])} vs ${String(second[key])}`,
    )
  }

  // Package-part preservation is an identity check, not a count: equal
  // counts can hide a dropped part behind an added one, so the diff runs on
  // part names and the preservation roles the parser assigned.
  const secondParts = new Map(
    second.packageParts.map((part) => [part.name, part.role]),
  )
  const lost = first.packageParts.flatMap((part) => {
    const role = secondParts.get(part.name)
    if (role === undefined) return [`dropped ${part.name} (${part.role})`]
    if (role !== part.role) {
      return [`${part.name} role ${part.role} -> ${role}`]
    }
    return []
  })
  push(
    'source parts preserved',
    lost.length === 0,
    lost.length === 0
      ? `${String(first.packageParts.length)} parts carried over`
      : lost.join('; '),
  )

  // Additions are directional: a passive part the producer added — Word's
  // docProps/app.xml is the evidence this harness requires — is recorded by
  // name, while an addition that takes an active role (story, styles,
  // numbering, relationships, content-types) changes the document's
  // structure and fails.
  const firstNames = new Set(first.packageParts.map((part) => part.name))
  const added = second.packageParts.filter((part) => !firstNames.has(part.name))
  const unexpected = added.filter((part) => part.role !== 'opaque')
  const passive = added.filter((part) => part.role === 'opaque')
  push(
    'package part additions',
    unexpected.length === 0,
    [
      ...unexpected.map((part) => `unexpected ${part.role} part ${part.name}`),
      ...passive.map((part) => `recorded ${part.name} (${part.role})`),
    ].join('; ') || 'none',
  )

  const firstRels = new Set(first.relationships)
  const secondRels = new Set(second.relationships)
  const relDelta = [
    ...first.relationships
      .filter((rel) => !secondRels.has(rel))
      .map((rel) => `dropped ${rel}`),
    ...second.relationships
      .filter((rel) => !firstRels.has(rel))
      .map((rel) => `added ${rel}`),
  ]
  push(
    'relationships preserved',
    relDelta.length === 0,
    relDelta.length === 0
      ? `${String(first.relationships.length)} bindings identical`
      : relDelta.join('; '),
  )
  return checks
}
