import type { SourcePart } from './model'
import { CUSTOM_PROPERTIES_NAMESPACE } from './parts/custom-properties'
import { relationshipSourcePartName } from './parts/rels'
import { WORD_NAMESPACE } from './parts/xml-elements'
import { canonicalImageExtension } from './share-safe-binary'
import { XML_DECLARATION } from './share-safe-emit'
import {
  CONTENT_TYPES_NAMESPACE,
  CONTENT_TYPES_PART,
  CORE_PROPERTIES_NAMESPACE,
  DRAWINGML_MAIN_NAMESPACE,
  EXTENDED_PROPERTIES_NAMESPACE,
  PACKAGE_OWNER,
  relationshipsPartFor,
  type ShareSafePartDisposition,
  type ShareSafePlan,
} from './share-safe-parts'
import { refuseShareSafe } from './share-safe-refusal'

/**
 * Canonical package naming and declaration emission. A part name, a
 * `Target` spelling, an `Override` `PartName` and every content-type value
 * are author-controlled identifier strings — left alone they carry an
 * arbitrary payload out in three different places (the zip entry name, the
 * owning part's declarations and `[Content_Types].xml`). Everything here is
 * generated: parts get the name their role dictates, relationship targets
 * are spelled relative from the emitted owner, and the content-types part
 * is written wholesale from the plan.
 */

const WML_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.'
const WORDML = (tail: string) => `${WML_MIME}${tail}+xml`

const RELS_CONTENT_TYPE =
  'application/vnd.openxmlformats-package.relationships+xml'

/** Image formats the binary layer can re-serialise → their MIME type. */
const CANONICAL_IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ['png', 'image/png'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
])

/**
 * `Extension` → `ContentType` pairs a `[Content_Types].xml` may declare as
 * a `Default`: the relationships default plus one per image format the
 * binary layer can prove. Any other `Default` in emitted bytes is a writer
 * splice.
 */
export const CANONICAL_DEFAULT_CONTENT_TYPES: ReadonlyMap<string, string> =
  new Map([['rels', RELS_CONTENT_TYPE], ...CANONICAL_IMAGE_TYPES])

type CanonicalRole = {
  /** Parts that repeat per document get a generated ordinal name. */
  path?: string
  countedPrefix?: string
  mime: string
}

const counted = (prefix: string, mime: string): CanonicalRole => ({
  countedPrefix: prefix,
  mime,
})

/**
 * The part name and MIME type each shipped role emits — the shape Word
 * writes for a new document, so a clean export carries no trace of how the
 * source package named its parts.
 */
const CANONICAL_PART_ROLES: ReadonlyMap<string, CanonicalRole> = new Map([
  [
    `${WORD_NAMESPACE} document`,
    { path: 'word/document.xml', mime: WORDML('document.main') },
  ],
  [
    `${WORD_NAMESPACE} styles`,
    { path: 'word/styles.xml', mime: WORDML('styles') },
  ],
  [
    `${WORD_NAMESPACE} numbering`,
    { path: 'word/numbering.xml', mime: WORDML('numbering') },
  ],
  [
    `${WORD_NAMESPACE} fonts`,
    { path: 'word/fontTable.xml', mime: WORDML('fontTable') },
  ],
  [
    `${WORD_NAMESPACE} webSettings`,
    { path: 'word/webSettings.xml', mime: WORDML('webSettings') },
  ],
  [
    `${WORD_NAMESPACE} settings`,
    { path: 'word/settings.xml', mime: WORDML('settings') },
  ],
  [
    `${WORD_NAMESPACE} footnotes`,
    { path: 'word/footnotes.xml', mime: WORDML('footnotes') },
  ],
  [
    `${WORD_NAMESPACE} endnotes`,
    { path: 'word/endnotes.xml', mime: WORDML('endnotes') },
  ],
  [`${WORD_NAMESPACE} hdr`, counted('word/header', WORDML('header'))],
  [`${WORD_NAMESPACE} ftr`, counted('word/footer', WORDML('footer'))],
  [
    `${DRAWINGML_MAIN_NAMESPACE} theme`,
    {
      path: 'word/theme/theme1.xml',
      mime: 'application/vnd.openxmlformats-officedocument.theme+xml',
    },
  ],
  [
    `${CORE_PROPERTIES_NAMESPACE} coreProperties`,
    {
      path: 'docProps/core.xml',
      mime: 'application/vnd.openxmlformats-package.core-properties+xml',
    },
  ],
  [
    `${EXTENDED_PROPERTIES_NAMESPACE} Properties`,
    {
      path: 'docProps/app.xml',
      mime: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
    },
  ],
  [
    `${CUSTOM_PROPERTIES_NAMESPACE} Properties`,
    {
      path: 'docProps/custom.xml',
      mime: 'application/vnd.openxmlformats-officedocument.custom-properties+xml',
    },
  ],
])

/** Every content type an `Override` declaration may emit. */
export const CANONICAL_OVERRIDE_CONTENT_TYPES: ReadonlySet<string> = new Set(
  [...CANONICAL_PART_ROLES.values()].map((role) => role.mime),
)

/**
 * A name canonical emission could produce: bounded segments, no traversal,
 * no whitespace, no markup characters. `.rels` parts and the content-types
 * stream pass too — `_rels/.rels` is itself a legal spelling.
 */
export function isCanonicalPartName(name: string) {
  if (!/^[\w.-]+(?:\/[\w.-]+)*$/u.test(name)) return false
  return !name.split('/').some((segment) => segment === '.' || segment === '..')
}

/**
 * The `Target` spelling canonical rels emission writes — relative to the
 * owning part, so an absolute or traversal-laden input spelling becomes the
 * one canonical form.
 */
export const CANONICAL_RELATIONSHIP_TARGET =
  /^(?:\.\.\/)*[\w.-]+(?:\/[\w.-]+)*$/u

/**
 * Computes the name every kept non-declaration part emits under. Ordinals
 * (`header1`, `image2`) follow plan order — the declaration order the
 * reachability walk recorded — so the same document names its parts the
 * same way twice, and a re-parse of emitted bytes computes the identity.
 */
export function canonicalPartNames(
  dispositions: ReadonlyMap<string, ShareSafePartDisposition>,
  sourceParts: ReadonlyMap<string, SourcePart>,
): Map<string, string> {
  const renames = new Map<string, string>()
  const counters = new Map<string, number>()
  const assigned = new Set<string>()
  for (const [name, disposition] of dispositions) {
    if (disposition.kind === 'drop') continue
    if (name === CONTENT_TYPES_PART || name.endsWith('.rels')) continue
    const role = disposition.root
    let canonical: string
    if (role === undefined) {
      const part = sourceParts.get(name)
      const extension = part && canonicalImageExtension(part)
      if (extension === undefined) {
        refuseShareSafe(
          'unverifiable-output',
          `binary part ${name} has no canonical image name`,
        )
      }
      const ordinal = (counters.get('media') ?? 0) + 1
      counters.set('media', ordinal)
      canonical = `word/media/image${ordinal}.${extension}`
    } else {
      const spec = CANONICAL_PART_ROLES.get(
        `${role.namespaceUri} ${role.localName}`,
      )
      if (spec === undefined) {
        refuseShareSafe(
          'unverifiable-output',
          `kept part ${name} has no canonical name for its role`,
        )
      }
      if (spec.path !== undefined) {
        canonical = spec.path
      } else {
        const ordinal = (counters.get(spec.countedPrefix!) ?? 0) + 1
        counters.set(spec.countedPrefix!, ordinal)
        canonical = `${spec.countedPrefix}${ordinal}.xml`
      }
    }
    if (assigned.has(canonical)) {
      refuseShareSafe(
        'unverifiable-output',
        `kept parts collide on canonical name ${canonical}`,
      )
    }
    assigned.add(canonical)
    renames.set(name, canonical)
  }
  return renames
}

/**
 * The name a kept `.rels` part emits under — derived from the canonical
 * name of the part it declares relationships for.
 */
export function canonicalRelsPartName(
  name: string,
  renames: ReadonlyMap<string, string>,
) {
  let owner: string
  try {
    owner = relationshipSourcePartName(name)
  } catch {
    return name
  }
  const renamed = owner === PACKAGE_OWNER ? owner : renames.get(owner)
  return renamed === undefined ? name : relationshipsPartFor(renamed)
}

/**
 * The `Target` a kept relationship declaration emits: the canonical target
 * name spelled relative to the canonical owner name — `media/image1.png`,
 * `../docProps/custom.xml` — never the input's spelling.
 */
export function canonicalRelationshipTarget(
  ownerPartName: string,
  targetPartName: string,
) {
  if (ownerPartName === PACKAGE_OWNER) return targetPartName
  const slash = ownerPartName.lastIndexOf('/')
  const ownerDirectory = slash === -1 ? '' : ownerPartName.slice(0, slash + 1)
  if (targetPartName.startsWith(ownerDirectory)) {
    return targetPartName.slice(ownerDirectory.length)
  }
  const ownerSegments =
    ownerDirectory === '' ? [] : ownerDirectory.slice(0, -1).split('/')
  const targetSegments = targetPartName.split('/')
  let common = 0
  while (
    common < ownerSegments.length &&
    common < targetSegments.length - 1 &&
    ownerSegments[common] === targetSegments[common]
  ) {
    common += 1
  }
  return (
    '../'.repeat(ownerSegments.length - common) +
    targetSegments.slice(common).join('/')
  )
}

/**
 * Writes `[Content_Types].xml` wholesale from the plan: a `rels` `Default`,
 * one `Default` per image format the copy carries, and an `Override` per
 * shipped XML part at its canonical name with its role's MIME type. Order
 * is sorted and deterministic; the original declarations inform nothing
 * but the kept-part set.
 */
export function canonicalContentTypesXml(plan: ShareSafePlan) {
  const defaults = new Map<string, string>()
  const overrides: { name: string; mime: string }[] = []
  for (const [name, disposition] of plan.dispositions) {
    if (disposition.kind === 'drop' || name === CONTENT_TYPES_PART) continue
    const emitted = name.endsWith('.rels')
      ? canonicalRelsPartName(name, plan.partRenames)
      : (plan.partRenames.get(name) ?? name)
    if (emitted.endsWith('.rels')) {
      defaults.set('rels', RELS_CONTENT_TYPE)
      continue
    }
    const root = disposition.root
    if (root === undefined) {
      const extension = emitted.slice(emitted.lastIndexOf('.') + 1)
      const mime = CANONICAL_IMAGE_TYPES.get(extension)
      if (mime === undefined) {
        refuseShareSafe(
          'unverifiable-output',
          `emitted part ${emitted} has no canonical content type`,
        )
      }
      defaults.set(extension, mime)
      continue
    }
    const role = CANONICAL_PART_ROLES.get(
      `${root.namespaceUri} ${root.localName}`,
    )
    if (role === undefined) {
      refuseShareSafe(
        'unverifiable-output',
        `kept part ${name} has no canonical content type`,
      )
    }
    overrides.push({ name: emitted, mime: role.mime })
  }
  const declarations = [...defaults.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([extension, mime]) =>
        `<Default Extension="${extension}" ContentType="${mime}"/>`,
    )
  for (const { name, mime } of [...overrides].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    declarations.push(`<Override PartName="/${name}" ContentType="${mime}"/>`)
  }
  return (
    `${XML_DECLARATION}<Types xmlns="${CONTENT_TYPES_NAMESPACE}">` +
    declarations.join('') +
    '</Types>'
  )
}
