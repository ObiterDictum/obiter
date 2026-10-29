import type { SourcePart } from './model'
import {
  CANONICAL_DEFAULT_CONTENT_TYPES,
  CANONICAL_OVERRIDE_CONTENT_TYPES,
  CANONICAL_RELATIONSHIP_TARGET,
  isCanonicalPartName,
} from './share-safe-canonical'
import { CONTENT_TYPES_PART, KEEP_RELATIONSHIPS } from './share-safe-parts'
import { refuseShareSafe } from './share-safe-refusal'

const EMITTED_RELATIONSHIP_TYPES = new Set(KEEP_RELATIONSHIPS.keys())

const RELATIONSHIP_TAG_ATTRIBUTES = new Set(['Id', 'Type', 'Target'])
const DEFAULT_TAG_ATTRIBUTES = new Set(['Extension', 'ContentType'])
const OVERRIDE_TAG_ATTRIBUTES = new Set(['PartName', 'ContentType'])

export function isDeclarationPartName(name: string) {
  return name === CONTENT_TYPES_PART || name.endsWith('.rels')
}

export function checkEmittedPartName(part: SourcePart) {
  if (part.name === CONTENT_TYPES_PART) return
  if (!isCanonicalPartName(part.name)) {
    refuseShareSafe(
      'unverifiable-output',
      `${part.name} is not a canonical emitted part name`,
    )
  }
}

export function checkDeclarationTagBytes(
  part: SourcePart,
  tagName: string,
  attributes: ReadonlyMap<string, string>,
  qualifiedAttributes: ReadonlySet<string>,
  relationshipSequence: { next: number },
) {
  const allowed =
    tagName === 'Relationship'
      ? RELATIONSHIP_TAG_ATTRIBUTES
      : tagName === 'Default'
        ? DEFAULT_TAG_ATTRIBUTES
        : tagName === 'Override'
          ? OVERRIDE_TAG_ATTRIBUTES
          : undefined
  if (allowed === undefined) return
  if (qualifiedAttributes.size > 0) {
    refuseShareSafe(
      'unverifiable-output',
      `${part.name} emits a qualified attribute on ${tagName}`,
    )
  }
  for (const name of attributes.keys()) {
    if (!allowed.has(name)) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} emits ${tagName} with undeclared attribute ${name}`,
      )
    }
  }
  if (tagName === 'Relationship') {
    const id = attributes.get('Id')
    const type = attributes.get('Type')
    const target = attributes.get('Target')
    if (id === undefined || type === undefined || target === undefined) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} emits an incomplete relationship declaration`,
      )
    }
    if (id !== `rId${relationshipSequence.next}`) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} emits non-canonical relationship id ${id}`,
      )
    }
    relationshipSequence.next += 1
    if (!EMITTED_RELATIONSHIP_TYPES.has(type)) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} emits an undeclared relationship type`,
      )
    }
    if (!CANONICAL_RELATIONSHIP_TARGET.test(target)) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} emits a non-canonical relationship target`,
      )
    }
    return
  }
  const contentType = attributes.get('ContentType')
  if (tagName === 'Default') {
    const extension = attributes.get('Extension')
    if (
      extension === undefined ||
      CANONICAL_DEFAULT_CONTENT_TYPES.get(extension) !== contentType
    ) {
      refuseShareSafe(
        'unverifiable-output',
        `${part.name} emits a non-canonical Default declaration`,
      )
    }
    return
  }
  const partName = attributes.get('PartName')
  if (
    partName === undefined ||
    !partName.startsWith('/') ||
    !isCanonicalPartName(partName.slice(1)) ||
    contentType === undefined ||
    !CANONICAL_OVERRIDE_CONTENT_TYPES.has(contentType)
  ) {
    refuseShareSafe(
      'unverifiable-output',
      `${part.name} emits a non-canonical Override declaration`,
    )
  }
}
