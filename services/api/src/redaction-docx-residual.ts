import {
  decodeXmlReferences,
  isWord,
  loadOoxmlZipEntries,
  WORD_NAMESPACE,
  type OoxmlPackageLimits,
} from '@obiter/ooxml'
import type { RedactionSpan } from '@obiter/redaction-policy'
import { RedactionDocxBurnError } from './redaction-docx-error'
import { hiddenXmlMarkup, mapDocxText } from './redaction-docx-map'
import { decodedXmlText } from './redaction-docx-xml'

/** Text carriers covered by the verified coordinate burn may deliberately keep
 * rejected duplicates. All other container content is checked independently.
 * Nested packages share a total expansion budget and a depth limit.
 */
export async function assertNoSpanTextSurvives(
  bytes: Uint8Array,
  affected: RedactionSpan[],
  preserved: RedactionSpan[] = [],
  limits?: OoxmlPackageLimits,
) {
  let budget = 72 * 1024 * 1024
  const needles = affected
    .filter((span) => span.text)
    .map((span) => ({
      text: span.text,
      utf8: Buffer.from(span.text, 'utf8'),
      utf16: Buffer.from(span.text, 'utf16le'),
    }))
  async function check(input: Uint8Array, path: string, depth: number) {
    if (depth > 4)
      throw new RedactionDocxBurnError(
        `Embedded package nesting exceeds safe limits in ${path}.`,
      )
    let entries: Map<string, Uint8Array>
    try {
      entries = await loadOoxmlZipEntries(input, limits)
    } catch {
      throw new RedactionDocxBurnError(
        `Package contents could not be verified in ${path || 'source DOCX'}.`,
      )
    }
    const mapping = depth === 0 ? mapDocxText(entries) : null
    if (mapping) {
      for (const needle of needles) {
        let start = mapping.text.indexOf(needle.text)
        while (start >= 0) {
          const end = start + needle.text.length
          if (containsText(mapping.text.slice(Math.max(0, start - 1), end + 1), needle.text) && !preserved.some(span => span.text === needle.text && span.start === start && span.end === end))
            throw new RedactionDocxBurnError('Redacted text survives in mapped document content; refusing .docx output.')
          start = mapping.text.indexOf(needle.text, start + 1)
        }
      }
    }
    const mapped = mapping?.nodes ?? []
    const ranges = new Map<string, typeof mapped>()
    for (const node of mapped) {
      const list = ranges.get(node.partName) ?? []
      list.push(node)
      ranges.set(node.partName, list)
    }
    for (const [name, payload] of entries) {
      budget -= payload.length
      const partPath = path ? `${path}!/${name}` : name
      if (budget < 0)
        throw new RedactionDocxBurnError(
          `Embedded package expansion exceeds safe limits in ${partPath}.`,
        )
      const buffer = Buffer.from(payload)
      if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
        await check(payload, partPath, depth + 1)
        continue
      }
      let hit = false
      if (/\.(?:xml|rels)$/iu.test(name)) {
        const source = new TextDecoder('utf-8', { fatal: true }).decode(payload)
        let residual = ''
        let cursor = 0
        for (const node of ranges.get(name) ?? []) {
          if (node.range.selfClosing) continue
          residual +=
            source.slice(cursor, node.range.startTagEnd) +
            hiddenXmlMarkup(
              source.slice(node.range.startTagEnd, node.range.endTagStart),
            )
          cursor = node.range.endTagStart
        }
        residual += source.slice(cursor)
        const texts = decodedXmlText(
          residual,
          (element, attribute) =>
            !(
              (/^word\/theme\/[^/]+\.xml$/iu.test(name) && element.namespaceUri === 'http://schemas.openxmlformats.org/drawingml/2006/main' && attribute.localName === 'typeface') ||
              (/^word\/(?:fontTable|styles)\.xml$/iu.test(name) && attribute.namespaceUri === WORD_NAMESPACE &&
                ((isWord(element, 'rFonts') && ['ascii', 'hAnsi', 'eastAsia', 'cs'].includes(attribute.localName)) ||
                  (name === 'word/fontTable.xml' && isWord(element, 'font') && attribute.localName === 'name')))
            ) && !(
              attribute.namespaceUri === WORD_NAMESPACE &&
              attribute.localName === 'val' &&
              /^(?:-?\d+(?:\.\d+)?|[\da-f]{6}|auto|black|[a-z]{2,3}(?:-[a-z]{2,4})*)$/iu.test(
                attribute.value,
              ) &&
              [
                'sz',
                'szCs',
                'color',
                'highlight',
                'spacing',
                'position',
                'kern',
                'lang',
              ].some((local) => isWord(element, local))
            ),
        )
        hit = needles.some((needle) =>
          texts.some((text) => containsText(decodeTarget(text), needle.text)),
        )
      } else {
        hit = needles.some(
          (needle) =>
            buffer.includes(needle.utf8) || buffer.includes(needle.utf16),
        )
      }
      if (hit)
        throw new RedactionDocxBurnError(
          `Redacted text survives in ${partPath}; refusing .docx output.`,
        )
    }
  }
  await check(bytes, '', 0)
}

export function decodeTarget(value: string) {
  let result = decodeXmlReferences(value)
  // Decode percent escapes without rejecting an ordinary literal percent sign.
  for (let i = 0; i < 4; i++) {
    const next = result.replace(/(?:%[\da-f]{2})+/giu, (encoded) => {
      try {
        return decodeURIComponent(encoded)
      } catch {
        return encoded
      }
    })
    if (next === result) break
    result = decodeXmlReferences(next)
  }
  return result
}

export function containsText(value: string, needle: string) {
  let offset = 0
  for (;;) {
    const index = value.indexOf(needle, offset)
    if (index < 0) return false
    const before = value[index - 1] ?? ''
    const after = value[index + needle.length] ?? ''
    if (
      !(
        /[\p{L}\p{N}]/u.test(needle[0] ?? '') && /[\p{L}\p{N}]/u.test(before)
      ) &&
      !(
        /[\p{L}\p{N}]/u.test(needle.at(-1) ?? '') && /[\p{L}\p{N}]/u.test(after)
      )
    )
      return true
    offset = index + 1
  }
}
