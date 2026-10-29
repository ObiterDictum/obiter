import type {
  DocumentModelWire,
  DocumentRelationshipWire,
} from '../../packages/contracts/src/document-model'
import type { SourcePartRole } from '../../packages/ooxml/src/model'
import { parseDocx } from '../../packages/ooxml/src/parse'
import { resolveRelationshipTarget } from '../../packages/ooxml/src/parts/rels'
import { paragraphOutlineLevel } from '../../packages/ooxml/src/table-of-contents-entries'

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
  packageParts: { name: string; role: SourcePartRole }[]
  relationships: string[]
}

export function documentBodyText(doc: {
  model: Pick<DocumentModelWire, 'stories'>
}): string {
  const story = doc.model.stories.find((item) => item.kind === 'document')
  return (story?.paragraphs ?? [])
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

function relationshipEntry(rel: DocumentRelationshipWire): string {
  const external = rel.targetMode?.toLowerCase() === 'external'
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

export function compare(
  first: Summary,
  second: Summary,
  expected?: { bodyText?: string },
) {
  const checks: { name: string; pass: boolean; detail: string }[] = []
  const push = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail })
  const bodyExpectation = expected?.bodyText
  const bodyPass = second.bodyText === (bodyExpectation ?? first.bodyText)
  push(
    bodyExpectation === undefined
      ? 'body text identical'
      : 'cycle-2 edit applied',
    bodyPass,
    bodyPass
      ? `${String(second.bodyText.length)} chars match`
      : bodyExpectation === undefined
        ? `cycle 1: "${first.bodyText.slice(0, 80)}…" vs cycle 2: "${second.bodyText.slice(0, 80)}…"`
        : `expected: "${bodyExpectation.slice(0, 80)}…" vs export: "${second.bodyText.slice(0, 80)}…"`,
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

  const relCounts = (entries: string[]) => {
    const counts = new Map<string, number>()
    for (const entry of entries) {
      counts.set(entry, (counts.get(entry) ?? 0) + 1)
    }
    return counts
  }
  const firstRels = relCounts(first.relationships)
  const secondRels = relCounts(second.relationships)
  const times = (count: number) => (count > 1 ? ` x${String(count)}` : '')
  const relDelta = [
    ...[...firstRels].flatMap(([entry, count]) => {
      const dropped = count - (secondRels.get(entry) ?? 0)
      return dropped > 0 ? [`dropped ${entry}${times(dropped)}`] : []
    }),
    ...[...secondRels].flatMap(([entry, count]) => {
      const added = count - (firstRels.get(entry) ?? 0)
      return added > 0 ? [`added ${entry}${times(added)}`] : []
    }),
  ]
  push(
    'relationships preserved',
    relDelta.length === 0,
    relDelta.length === 0
      ? `${String(first.relationships.length)} bindings identical`
      : `${String(first.relationships.length)} vs ${String(second.relationships.length)} bindings; ${relDelta.join('; ')}`,
  )
  return checks
}
