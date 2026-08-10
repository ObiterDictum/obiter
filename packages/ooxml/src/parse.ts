import type { DocumentStoryKind, DocumentModelWire } from '@obiter/contracts'
import JSZip from 'jszip'

import {
  createSequentialModelIdAllocator,
  OoxmlError,
  type OoxmlDocument,
  type ParseDocxOptions,
  type SourcePart,
} from './model'
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

const CONTENT_TYPES_PART = '[Content_Types].xml'
const decoder = new TextDecoder('utf-8', { fatal: true })

export async function parseDocx(
  input: Uint8Array,
  options: ParseDocxOptions = {},
) {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    throw new OoxmlError('invalid-package')
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  const payloads = new Map(
    await Promise.all(
      entries.map(
        async (entry) => [entry.name, await entry.async('uint8array')] as const,
      ),
    ),
  )
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
  const identity: IdentityContext = {
    allocator: options.idAllocator ?? createSequentialModelIdAllocator(),
    usedIds: new Set(),
  }
  const stories: DocumentModelWire['stories'] = []
  const textRunAnchors: OoxmlDocument['textRunAnchors'] = new Map()
  const preservedXmlFragments: DocumentModelWire['preservedXmlFragments'] = []

  for (const [partName, kind] of typedParts.stories) {
    const part = sourceParts.get(partName)
    if (!part || part.kind !== 'xml') continue
    const source = decodePart(part)
    const parsed = parseStory(partName, kind, source, identity)
    part.role = 'story'
    part.overlay = createXmlOverlay(source)
    part.trackedChanges = parsed.trackedChanges
    stories.push(parsed.story)
    for (const anchor of parsed.anchors)
      textRunAnchors.set(anchor.wire.id, anchor)
    preservedXmlFragments.push(
      ...parsed.trackedChanges.map(({ sourceFragment }) => ({
        partName,
        xml: sourceFragment,
      })),
    )
  }

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
    },
    sourceParts,
    textRunAnchors,
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
