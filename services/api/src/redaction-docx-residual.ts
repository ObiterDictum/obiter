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
  limits?: OoxmlPackageLimits,
) {
  let budget = 72 * 1024 * 1024
  const needles = [
    ...new Set(affected.map((span) => span.text).filter(Boolean)),
  ].map((text) => ({
    text,
    utf8: Buffer.from(text, 'utf8'),
    utf16: Buffer.from(text, 'utf16le'),
    utf16be: Buffer.from(text, 'utf16le').swap16(),
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
      const namedXml = /\.(?:xml|rels)$/iu.test(name)
      // Mapped offsets were computed on UTF-8 text, so those parts stay UTF-8.
      const source = ranges.has(name)
        ? new TextDecoder('utf-8', { fatal: true }).decode(payload)
        : namedXml
          ? decodeXmlPart(payload)
          : sniffXmlPart(payload)
      let hit =
        !namedXml &&
        needles.some(
          (needle) =>
            buffer.includes(needle.utf8) ||
            buffer.includes(needle.utf16) ||
            buffer.includes(needle.utf16be),
        )
      if (!hit && source !== null) {
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
        let texts: string[]
        try {
          texts = decodedXmlText(
            residual,
            (element, attribute) =>
              // Font names are definitions, not content: a person may share a
              // name with the theme, style or run font that displays it.
              !(
                (element.namespaceUri ===
                  'http://schemas.openxmlformats.org/drawingml/2006/main' &&
                  attribute.localName === 'typeface') ||
                (attribute.namespaceUri === WORD_NAMESPACE &&
                  ((isWord(element, 'rFonts') &&
                    ['ascii', 'hAnsi', 'eastAsia', 'cs'].includes(
                      attribute.localName,
                    )) ||
                    (name === 'word/fontTable.xml' &&
                      isWord(element, 'font') &&
                      attribute.localName === 'name')))
              ) &&
              !(
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
        } catch (error) {
          // Markup-like content that is not well-formed XML (an HTML altChunk,
          // say) is still entity-decoded whole; named XML parts must parse.
          if (namedXml) throw error
          texts = [residual]
        }
        // Fail closed on any substring: identifiers, link targets and custom
        // XML have no word boundaries a reviewer could have relied on.
        const decoded = texts.map(decodeTarget)
        hit = needles.some((needle) =>
          decoded.some((text) => containsResidual(text, needle.text)),
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

/** Decode an XML part by BOM, UTF-16 shape or declaration. Undecodable
 * bytes, or a declaration contradicting single-byte content, throw. */
function decodeXmlPart(payload: Uint8Array) {
  const [a, b, c, d] = payload
  if ((a === 0xff && b === 0xfe) || (a === 0x3c && b === 0 && c === 0x3f))
    return new TextDecoder('utf-16le', { fatal: true }).decode(payload)
  if ((a === 0xfe && b === 0xff) || (a === 0 && b === 0x3c && d === 0x3f))
    return new TextDecoder('utf-16be', { fatal: true }).decode(payload)
  const bom = a === 0xef && b === 0xbb && c === 0xbf ? 3 : 0
  const declared =
    /^<\?xml[^>]*?\sencoding\s*=\s*["']([\w.:-]+)["']/iu.exec(
      Buffer.from(payload.subarray(bom, bom + 200)).toString('latin1'),
    )?.[1] ?? 'utf-8'
  if (!bom && /^(?:utf-?16|ucs-?2)/iu.test(declared))
    throw new Error('XML declares UTF-16 but is not UTF-16 encoded.')
  // SAFETY: TextDecoder validates the label at runtime; an unsupported
  // declared encoding throws, refusing the output.
  const label = (bom ? 'utf-8' : declared) as ConstructorParameters<
    typeof TextDecoder
  >[0]
  return new TextDecoder(label, { fatal: true }).decode(payload)
}

/** Parts of any name whose content is XML: a BOM or a leading tag. */
function sniffXmlPart(payload: Uint8Array) {
  const [a, b, c] = payload
  const marked =
    (a === 0xef && b === 0xbb && c === 0xbf) ||
    (a === 0xff && b === 0xfe) ||
    (a === 0xfe && b === 0xff) ||
    (a === 0 && b === 0x3c) ||
    (a === 0x3c && b === 0) ||
    /^\s*</u.test(Buffer.from(payload.subarray(0, 64)).toString('latin1'))
  if (!marked) return null
  try {
    return decodeXmlPart(payload)
  } catch {
    // Undecodable markup-like bytes keep the raw byte check only.
    return null
  }
}

export function decodeTarget(value: string) {
  let result = decodeReferences(value)
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
    result = decodeReferences(next)
  }
  return result
}

/** Values are often already decoded once, so a literal "&" is ordinary text. */
function decodeReferences(value: string) {
  return value.replace(/&#?[\da-z]+;/giu, (reference) => {
    try {
      return decodeXmlReferences(reference)
    } catch {
      return reference
    }
  })
}

/** Substring match, except that a number is not found inside a longer
 * number: accepted "24" must not refuse the date 2024 in docProps. */
function containsResidual(value: string, needle: string) {
  for (
    let index = value.indexOf(needle);
    index >= 0;
    index = value.indexOf(needle, index + 1)
  ) {
    const before = value[index - 1] ?? ''
    const after = value[index + needle.length] ?? ''
    if (
      !(/\d/u.test(needle[0] ?? '') && /\d/u.test(before)) &&
      !(/\d/u.test(needle.at(-1) ?? '') && /\d/u.test(after))
    )
      return true
  }
  return false
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
