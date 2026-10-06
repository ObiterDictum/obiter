import {
  escapeXmlAttribute,
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import {
  attributeValue,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'

// Pending replacement values are fragments without namespace declarations, so
// bookmark attributes written earlier in the batch are read from the attribute
// text rather than parsed as a document.
const PENDING_BOOKMARK_NAME = /<w:bookmarkStart[^>]*\bw:name="([^"]*)"/gu
const PENDING_BOOKMARK_ID = /<w:bookmarkStart[^>]*\bw:id="(\d+)"/gu

/**
 * Ensures `target` carries a `namePrefix`-family bookmark and returns its
 * name. A bookmark in the family already inside the target's range is
 * reused, so repeat references stay idempotent; otherwise the next free
 * `<namePrefix><n>` is allocated from the whole part — source and pending
 * replacements alike — because wire ids are encounter-order on documents
 * without `w14:paraId` and shift under a later parse, so they cannot seed a
 * durable name. The bookmarkStart/End pair wraps the paragraph's content —
 * after `w:pPr`, before `</w:p>` — so the paragraph's runs become the
 * bookmark's anchor text.
 */
export function ensureParagraphBookmark(
  document: OoxmlDocument,
  target: ParagraphAnchor,
  namePrefix: string,
) {
  const part = requireEditablePart(document, target.partName)
  const elements = parseXmlElements(part.overlay.source)
  const range = target.paragraphRange
  const { inRange, taken } = bookmarkNamesInUse(
    part.overlay,
    elements,
    range,
    namePrefix,
  )
  // A family bookmark already wrapping the paragraph is the bookmark —
  // writing a second pair with the same name would nest a duplicate.
  if (inRange) return inRange
  const name = `${namePrefix}${String(nextNameIndex(taken, namePrefix))}`
  const paragraphElement = elements.find(
    (element) => isWord(element, 'p') && element.start === range.start,
  )
  if (!paragraphElement) throw new OoxmlError('invalid-document-edit')
  const id = nextBookmarkId(part.overlay)
  const bookmarkStart = `<w:bookmarkStart w:id="${String(id)}" w:name="${escapeXmlAttribute(name)}"/>`
  const bookmarkEnd = `<w:bookmarkEnd w:id="${String(id)}"/>`
  if (paragraphElement.selfClosing) {
    refuseCoveringReplacement(part.overlay.replacements, range.start, range.end)
    const opening = part.overlay.source
      .slice(range.start, range.startTagEnd)
      .replace(/\/\s*>$/u, '>')
    setOverlayReplacement(part.overlay, `${target.wire.id}:bookmark:${name}`, {
      start: range.start,
      end: range.end,
      value: `${opening}${bookmarkStart}${bookmarkEnd}</w:p>`,
    })
    part.dirty = true
    target.wire.preservedXmlFragments.push(bookmarkStart, bookmarkEnd)
    return name
  }
  const propertiesElement = elements.find(
    (element) =>
      isWord(element, 'pPr') &&
      element.depth === paragraphElement.depth + 1 &&
      element.start >= paragraphElement.startTagEnd &&
      element.end <= paragraphElement.endTagStart,
  )
  const startPoint = propertiesElement
    ? propertiesElement.end
    : paragraphElement.startTagEnd
  const endPoint = paragraphElement.endTagStart
  for (const replacement of part.overlay.replacements.values()) {
    if (replacement.start <= range.start && replacement.end >= range.end) {
      throw new OoxmlError('invalid-document-edit')
    }
    if (
      (replacement.start < startPoint && startPoint < replacement.end) ||
      (replacement.start < endPoint && endPoint < replacement.end)
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
  setOverlayReplacement(
    part.overlay,
    `${target.wire.id}:bookmark:${name}:start`,
    {
      start: startPoint,
      end: startPoint,
      value: bookmarkStart,
    },
  )
  setOverlayReplacement(
    part.overlay,
    `${target.wire.id}:bookmark:${name}:end`,
    {
      start: endPoint,
      end: endPoint,
      value: bookmarkEnd,
    },
  )
  part.dirty = true
  target.wire.preservedXmlFragments.push(bookmarkStart, bookmarkEnd)
  return name
}

function refuseCoveringReplacement(
  replacements: ReadonlyMap<string, { start: number; end: number }>,
  start: number,
  end: number,
) {
  for (const replacement of replacements.values()) {
    if (replacement.start <= start && replacement.end >= end) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
}

/**
 * Every `namePrefix`-family bookmark name in the part, split into the name
 * already sitting inside `range` — the candidate for reuse — and the full
 * taken set the allocator must avoid.
 */
function bookmarkNamesInUse(
  overlay: XmlOverlay,
  elements: readonly XmlElement[],
  range: { start: number; end: number },
  namePrefix: string,
) {
  const taken = new Set<string>()
  let inRange: string | undefined
  const record = (name: string | undefined, inside: boolean) => {
    if (name === undefined || !name.startsWith(namePrefix)) return
    taken.add(name)
    if (inside) inRange ??= name
  }
  for (const element of elements) {
    if (!isWord(element, 'bookmarkStart')) continue
    record(
      attributeValue(element, WORD_NAMESPACE, 'name'),
      element.start >= range.start && element.end <= range.end,
    )
  }
  for (const replacement of overlay.replacements.values()) {
    const inside =
      replacement.start >= range.start && replacement.end <= range.end
    for (const match of replacement.value.matchAll(PENDING_BOOKMARK_NAME)) {
      record(match[1], inside)
    }
  }
  return { inRange, taken }
}

/**
 * One more than the highest numeric suffix among the taken
 * `<namePrefix><n>` names, so an allocated name can never collide with or
 * recycle an existing one.
 */
function nextNameIndex(taken: ReadonlySet<string>, namePrefix: string) {
  let next = 1
  for (const name of taken) {
    const digits = name.slice(namePrefix.length)
    const value = /^\d+$/u.test(digits)
      ? Number.parseInt(digits, 10)
      : Number.NaN
    if (Number.isInteger(value) && value >= next) next = value + 1
  }
  return next
}

/**
 * One more than the highest `w:id` among the part's bookmarkStarts — source
 * and pending replacements, since a same-batch bookmark exists only as a
 * pending value.
 */
function nextBookmarkId(overlay: XmlOverlay) {
  let next = 0
  for (const element of parseXmlElements(overlay.source)) {
    if (!isWord(element, 'bookmarkStart')) continue
    const raw = attributeValue(element, WORD_NAMESPACE, 'id')
    const value = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
    if (Number.isInteger(value) && value >= next) next = value + 1
  }
  for (const replacement of overlay.replacements.values()) {
    for (const match of replacement.value.matchAll(PENDING_BOOKMARK_ID)) {
      const value = Number.parseInt(match[1] ?? '', 10)
      if (Number.isInteger(value) && value >= next) next = value + 1
    }
  }
  return next
}
