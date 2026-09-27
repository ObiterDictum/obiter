import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

import type { OoxmlDocument } from './model'
import { parseXmlElements, setOverlayReplacement } from './parts/overlay'
import { requireEditablePart } from './model-edit-overlay'

export const WORD_2010_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordml'

const CANONICAL_PARA_ID = /^[0-9A-Fa-f]{8}$/u

/**
 * `w14:paraId` is the only standard persisted paragraph identity (`AG_Parids`
 * applies to `CT_P`). Word preserves it on round-trip, and our parser derives
 * the model id `para-w14-<value>` from it. Canonicalising every editable
 * paragraph in a new version gives cross-version paragraph identity without a
 * positional guess: a paragraph that already carries a valid, unique id keeps
 * it; an absent, malformed or duplicate one receives a deterministic fresh
 * value, and no two source paragraphs are ever given the same identity.
 *
 * The attribute is written through the existing overlay, so it lands only in
 * the document being serialised. Historical versions are never rewritten.
 */
export function canonicaliseParagraphIdentities(
  document: OoxmlDocument,
): Map<DocumentParagraphWire, string> {
  const used = collectExistingIds(document.model)
  const canonical = new Map<DocumentParagraphWire, string>()
  const seenInDocument = new Set<string>()
  let counter = 0
  const nextId = () => {
    for (;;) {
      counter += 1
      // 8 uppercase hex digits, matching ST_LongHexNumber; never zero.
      if (counter > 0xffffffff) throw new Error('paragraph-id-space-exhausted')
      const value = counter.toString(16).toUpperCase().padStart(8, '0')
      if (value === '00000000') continue
      if (used.has(value)) continue
      used.add(value)
      return value
    }
  }

  const namespaceParts = new Set<string>()
  for (const story of document.model.stories) {
    // Only the main document story is editable by the supported actions, so
    // only it needs persisted identity. Other parts keep their bytes and ids
    // untouched, and their existing w14 values still seed the used set above.
    if (story.kind !== 'document') continue
    for (const paragraph of story.paragraphs) {
      const existing = paragraph.sourceParaId
      const valid =
        existing !== undefined &&
        CANONICAL_PARA_ID.test(existing) &&
        existing !== '00000000' &&
        !seenInDocument.has(existing.toUpperCase())
      const value = valid ? existing.toUpperCase() : nextId()
      if (existing === undefined || !valid) {
        paragraph.sourceParaId = value
      }
      seenInDocument.add(value)
      canonical.set(paragraph, `para-w14-${value}`)
      namespaceParts.add(story.partName)
    }
  }

  for (const partName of namespaceParts) {
    if (!document.sourceParts.has(partName)) continue
    const part = requireEditablePart(document, partName)
    ensureWord2010Namespace(part.overlay)
  }
  for (const story of document.model.stories) {
    if (story.kind !== 'document') continue
    for (const paragraph of story.paragraphs) {
      const value = paragraph.sourceParaId
      if (!value) continue
      if (!document.sourceParts.has(story.partName)) continue
      const part = requireEditablePart(document, story.partName)
      const anchor = document.paragraphAnchors.get(paragraph.id)
      if (anchor) {
        const startTag = part.overlay.source.slice(
          anchor.paragraphRange.start,
          anchor.paragraphRange.startTagEnd,
        )
        setOverlayReplacement(part.overlay, `${paragraph.id}:para-id`, {
          start: anchor.paragraphRange.start,
          end: anchor.paragraphRange.startTagEnd,
          value: injectAttribute(startTag, 'w14:paraId', value),
        })
        part.dirty = true
        continue
      }
      // An inserted paragraph has no parsed anchor: its identity is injected
      // into the overlay replacement the insert writer produced.
      const key = `${paragraph.id}:insert`
      const replacement = part.overlay.replacements.get(key)
      if (!replacement) continue
      setOverlayReplacement(part.overlay, key, {
        ...replacement,
        value: injectIntoOpeningTag(replacement.value, value),
      })
      part.dirty = true
    }
  }
  return canonical
}

function collectExistingIds(model: DocumentModelWire) {
  const used = new Set<string>()
  for (const story of model.stories) {
    for (const paragraph of story.paragraphs) {
      const value = paragraph.sourceParaId
      if (value && CANONICAL_PARA_ID.test(value)) {
        used.add(value.toUpperCase())
      }
    }
  }
  return used
}

/** Injects an attribute into the opening tag of a `<w:p>…</w:p>` fragment. */
function injectIntoOpeningTag(fragment: string, value: string) {
  const match = fragment.match(/^<[^>]*>/u)
  if (!match) return fragment
  return `${injectAttribute(match[0], 'w14:paraId', value)}${fragment.slice(match[0].length)}`
}

function ensureWord2010Namespace(overlay: {
  source: string
  replacements: Map<string, { start: number; end: number; value: string }>
}) {
  if (/xmlns:w14=/u.test(overlay.source.slice(0, 4096))) return
  const root = parseXmlElements(overlay.source).find(
    (element) => element.depth === 0,
  )
  if (!root) return
  const startTag = overlay.source.slice(root.start, root.startTagEnd)
  const declared = `xmlns:w14="${WORD_2010_NAMESPACE}"`
  const value = startTag.replace(/(\s|>)/u, (match) => ` ${declared}${match}`)
  setOverlayReplacement(overlay, 'lineage:w14-namespace', {
    start: root.start,
    end: root.startTagEnd,
    value,
  })
}

function injectAttribute(startTag: string, name: string, value: string) {
  const existing = new RegExp(`${name}="[^"]*"`, 'u')
  if (existing.test(startTag)) {
    return startTag.replace(existing, `${name}="${value}"`)
  }
  const closing = startTag.match(/\s*\/?>$/u)
  if (!closing) return `${startTag} ${name}="${value}">`
  const index = startTag.length - closing[0].length
  return `${startTag.slice(0, index)} ${name}="${value}"${closing[0]}`
}
