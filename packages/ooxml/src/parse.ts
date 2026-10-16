import type { DocumentStoryKind, DocumentModelWire } from '@obiter/contracts'

import {
  createSequentialModelIdAllocator,
  OoxmlError,
  type OoxmlDocument,
  type ParseDocxOptions,
  type SourcePart,
  type TrackedChangeNode,
} from './model'
import { extractImportedComments } from './comment-import'
import { loadOoxmlZipEntries } from './package-loader'
import { parseContentTypes, isXmlPart } from './parts/content-types'
import { parseNumbering } from './parts/numbering'
import { createOpaquePart } from './parts/opaque'
import { createXmlOverlay } from './parts/overlay'
import {
  parseRelationshipPart,
  relationshipKind,
  resolveRelationshipTarget,
} from './parts/rels'
import { parseStory, type IdentityContext } from './parts/stories'
import { parseStyles } from './parts/styles'
import { markUndecidableChanges } from './tracked-change-decisions'
import { HYPERLINK_RELATIONSHIP_TYPE } from './structure-xml'

const CONTENT_TYPES_PART = '[Content_Types].xml'
const decoder = new TextDecoder('utf-8', { fatal: true })

export async function parseDocx(
  input: Uint8Array,
  options: ParseDocxOptions = {},
) {
  let payloads: Map<string, Uint8Array>
  try {
    payloads = await loadOoxmlZipEntries(input, options.limits)
  } catch (error) {
    if (error instanceof OoxmlError) throw error
    throw new OoxmlError('invalid-package')
  }

  const contentTypesPayload = payloads.get(CONTENT_TYPES_PART)
  if (!contentTypesPayload) throw new OoxmlError('invalid-package')

  try {
    return parseParts(payloads, decoder.decode(contentTypesPayload), options)
  } catch {
    throw new OoxmlError('invalid-xml-part')
  }
}

function parseParts(
  payloads: ReadonlyMap<string, Uint8Array>,
  contentTypesXml: string,
  options: ParseDocxOptions,
): OoxmlDocument {
  const contentTypes = parseContentTypes(contentTypesXml)
  const sourceParts = new Map<string, SourcePart>()
  for (const [name, payload] of payloads) {
    sourceParts.set(
      name,
      createOpaquePart(
        name,
        isXmlPart(name, contentTypes) ? 'xml' : 'binary',
        payload,
      ),
    )
  }

  setTypedXmlPart(sourceParts, CONTENT_TYPES_PART, 'content-types')
  const relationships = []
  for (const part of sourceParts.values()) {
    if (part.kind !== 'xml' || !part.name.endsWith('.rels')) continue
    const source = decodePart(part)
    relationships.push(
      ...parseRelationshipPart(part.name, source).relationships,
    )
    setTypedXmlPart(sourceParts, part.name, 'relationships', source)
  }

  const typedParts = discoverTypedParts(relationships)
  let changeSequence = 1
  const identity: IdentityContext = {
    allocator: options.idAllocator ?? createSequentialModelIdAllocator(),
    usedIds: new Set(),
    nextChangeId() {
      const id = `change-${String(changeSequence).padStart(6, '0')}`
      changeSequence += 1
      return id
    },
  }
  const stories: DocumentModelWire['stories'] = []
  const textRunAnchors: OoxmlDocument['textRunAnchors'] = new Map()
  const paragraphAnchors: OoxmlDocument['paragraphAnchors'] = new Map()
  const preservedXmlFragments: DocumentModelWire['preservedXmlFragments'] = []
  const trackedChanges: OoxmlDocument['trackedChanges'] = new Map()

  for (const [partName, kind] of typedParts.stories) {
    const part = sourceParts.get(partName)
    if (!part || part.kind !== 'xml') continue
    const source = decodePart(part)
    // Hyperlink `r:id`s resolve on the part that owns the story, so the map
    // is scoped to its own relationships and to no other kind.
    const hyperlinkTargets = new Map(
      relationships
        .filter(
          (relationship) =>
            relationship.sourcePartName === partName &&
            relationship.type === HYPERLINK_RELATIONSHIP_TYPE,
        )
        .map((relationship) => [relationship.id, relationship.target]),
    )
    const parsed = parseStory(
      partName,
      kind,
      source,
      identity,
      hyperlinkTargets,
    )
    part.role = 'story'
    part.overlay = createXmlOverlay(source)
    part.trackedChanges = parsed.trackedChanges
    for (const change of parsed.trackedChanges) {
      trackedChanges.set(change.wire.id, change)
    }
    stories.push(parsed.story)
    for (const anchor of parsed.anchors)
      textRunAnchors.set(anchor.wire.id, anchor)
    for (const anchor of parsed.paragraphAnchors)
      paragraphAnchors.set(anchor.wire.id, anchor)
  }

  const changeNodes = [...trackedChanges.values()]
  matchMovePairs(changeNodes)
  // Pairing has run, so this is where the engine's static decidability lands
  // on the wire for every surface that lists the changes.
  markUndecidableChanges(changeNodes)

  const styles = parseOptionalTypedPart(
    sourceParts,
    typedParts.styles,
    'styles',
    parseStyles,
  )
  const numbering = parseOptionalTypedPart(
    sourceParts,
    typedParts.numbering,
    'numbering',
    parseNumbering,
  )

  return {
    model: {
      version: 1,
      stories,
      styles,
      numbering,
      relationships,
      preservedXmlFragments,
      changes: [...trackedChanges.values()].map(({ wire }) => wire),
      comments: extractImportedComments({
        relationships,
        sourceParts,
        paragraphAnchors,
      }),
    },
    sourceParts,
    textRunAnchors,
    paragraphAnchors,
    trackedChanges,
  }
}

function matchMovePairs(changes: TrackedChangeNode[]) {
  const moves = new Map<string, typeof changes>()
  for (const change of changes) {
    if (
      (change.wire.elementName !== 'moveFrom' &&
        change.wire.elementName !== 'moveTo') ||
      change.moveGroup === undefined
    ) {
      continue
    }
    const matches = moves.get(change.moveGroup) ?? []
    matches.push(change)
    moves.set(change.moveGroup, matches)
  }
  for (const [key, members] of moves) {
    const from = members.filter(({ wire }) => wire.elementName === 'moveFrom')
    const to = members.filter(({ wire }) => wire.elementName === 'moveTo')
    const fromNode = from[0]
    const toNode = to[0]
    // A container-named group is a real move with at least one member on
    // each side. The shared-w:id fallback is tolerated legacy markup, so it
    // keeps the strict one-from-one-to rule.
    const paired = key.startsWith('name:')
      ? from.length > 0 && to.length > 0
      : members.length === 2 && from.length === 1 && to.length === 1
    if (!paired || !fromNode || !toNode) continue
    for (const member of members) {
      member.validMoveCounterpart = true
      member.wire.pairId =
        member.wire.elementName === 'moveFrom'
          ? toNode.wire.id
          : fromNode.wire.id
    }
  }
}

function discoverTypedParts(relationships: DocumentModelWire['relationships']) {
  const stories = new Map<string, DocumentStoryKind>([
    ['word/document.xml', 'document'],
  ])
  let styles = 'word/styles.xml'
  let numbering = 'word/numbering.xml'

  for (const relationship of relationships) {
    const kind = relationshipKind(relationship.type)
    const target = resolveRelationshipTarget(relationship)
    if (!kind || !target) continue
    if (kind === 'styles') styles = target
    else if (kind === 'numbering') numbering = target
    else stories.set(target, kind)
  }

  return { stories, styles, numbering }
}

function parseOptionalTypedPart<Item>(
  parts: Map<string, SourcePart>,
  partName: string,
  role: 'styles' | 'numbering',
  parse: (source: string) => Item[],
) {
  const part = parts.get(partName)
  if (!part || part.kind !== 'xml') return []
  const source = decodePart(part)
  part.role = role
  part.overlay = createXmlOverlay(source)
  return parse(source)
}

function setTypedXmlPart(
  parts: Map<string, SourcePart>,
  partName: string,
  role: SourcePart['role'],
  source?: string,
) {
  const part = parts.get(partName)
  if (!part || part.kind !== 'xml')
    throw new Error('Required XML part is missing')
  part.role = role
  part.overlay = createXmlOverlay(source ?? decodePart(part))
}

function decodePart(part: SourcePart) {
  return decoder.decode(part.originalPayload)
}
