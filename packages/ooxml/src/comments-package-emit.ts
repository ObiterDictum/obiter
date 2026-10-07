import type { SourcePart } from './model'
import {
  commentExportError,
  WORD_2010_NAMESPACE,
} from './comments-package-parts'
import {
  escapeXmlAttribute,
  escapeXmlText,
  parseXmlElements,
} from './parts/overlay'
import { attributeValue, WORD_NAMESPACE } from './parts/xml-elements'

/** A `w15:commentEx` entry to append to the commentsExtended part. */
export type ExtendedCommentEntry = {
  paraId: string
  parentParaId?: string
  done?: boolean
}

export function extendedEntryXml(entry: ExtendedCommentEntry) {
  const parent =
    entry.parentParaId === undefined
      ? ''
      : ` w15:paraIdParent="${escapeXmlAttribute(entry.parentParaId)}"`
  const done = entry.done === true ? ' w15:done="1"' : ''
  return `<w15:commentEx w15:paraId="${escapeXmlAttribute(entry.paraId)}"${parent}${done}/>`
}

export function productCommentXml(input: {
  ooxmlId: number
  author: string
  createdAt: string
  body: string
  paraId: string | null
}) {
  const body = input.body
    .split(/\r\n|\r|\n/u)
    .map((line, index) =>
      index === 0
        ? `<w:t xml:space="preserve">${escapeXmlText(line)}</w:t>`
        : `<w:br/><w:t xml:space="preserve">${escapeXmlText(line)}</w:t>`,
    )
    .join('')
  // The w14 prefix is declared on the element itself so emitted comments
  // stay well-formed inside a foreign comments part whatever its root
  // namespaces declare.
  const namespace =
    input.paraId === null ? '' : ` xmlns:w14="${WORD_2010_NAMESPACE}"`
  const paraId =
    input.paraId === null
      ? ''
      : ` w14:paraId="${escapeXmlAttribute(input.paraId)}"`
  return `<w:comment w:id="${input.ooxmlId}" w:author="${escapeXmlAttribute(input.author)}" w:date="${escapeXmlAttribute(input.createdAt)}"${namespace}><w:p${paraId}><w:r>${body}</w:r></w:p></w:comment>`
}

export function highestForeignCommentId(part: SourcePart) {
  if (!part.overlay) throw commentExportError()
  let highest = -1
  for (const element of parseXmlElements(part.overlay.source)) {
    if (
      element.namespaceUri !== WORD_NAMESPACE ||
      element.localName !== 'comment'
    ) {
      continue
    }
    const value = attributeValue(element, WORD_NAMESPACE, 'id')
    if (value && /^-?\d+$/u.test(value)) {
      const numericId = Number(value)
      if (!Number.isSafeInteger(numericId)) throw commentExportError()
      highest = Math.max(highest, numericId)
    }
  }
  return highest
}

/** Every `w14:paraId` the comments part already carries, for collision-free allocation. */
export function commentParaIds(part: SourcePart) {
  if (!part.overlay) throw commentExportError()
  const ids = new Set<string>()
  for (const element of parseXmlElements(part.overlay.source)) {
    const paraId = attributeValue(element, WORD_2010_NAMESPACE, 'paraId')
    if (paraId) ids.add(paraId)
  }
  return ids
}

/**
 * Deterministic 8-hex-digit paraIds in a product-owned band. The counter
 * bumps until the id is unused in the comments part, so a foreign paraId can
 * never be claimed for a product comment.
 */
export function paraIdAllocator(used: ReadonlySet<string>) {
  let counter = 0
  return () => {
    for (;;) {
      const candidate = (0x0b1e0000 + counter)
        .toString(16)
        .toUpperCase()
        .padStart(8, '0')
      counter += 1
      if (!used.has(candidate)) return candidate
    }
  }
}
