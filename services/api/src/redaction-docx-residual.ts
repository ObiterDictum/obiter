import { decodeXmlReferences, isWord, loadOoxmlZipEntries } from '@obiter/ooxml'
import type { RedactionSpan } from '@obiter/redaction-policy'
import { RedactionDocxBurnError } from './redaction-docx-error'
import { mapDocxText } from './redaction-docx-map'
import { decodedXmlText } from './redaction-docx-xml'

/** Text carriers covered by the verified coordinate burn may deliberately keep
 * rejected duplicates. All other container content is checked independently.
 * Nested packages share a total expansion budget and a depth limit.
 */
export async function assertNoSpanTextSurvives(
  bytes: Uint8Array,
  affected: RedactionSpan[],
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
    const entries = await loadOoxmlZipEntries(input)
    const mapped = depth === 0 ? mapDocxText(entries).nodes : []
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
          residual += source.slice(cursor, node.range.start)
          cursor = node.range.end
        }
        residual += source.slice(cursor)
        const texts = decodedXmlText(
          residual,
          (element) =>
            ![
              'sz',
              'szCs',
              'color',
              'highlight',
              'spacing',
              'position',
              'kern',
              'lang',
            ].some((local) => isWord(element, local)),
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
