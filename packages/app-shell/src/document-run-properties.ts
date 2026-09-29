import {
  documentEditHighlightSchema,
  documentEditVertAlignSchema,
} from '@obiter/contracts'
import { findXmlTagEnd } from '@obiter/ooxml'
import type { HighlightValue, VertAlignValue } from './document-format-types'

/**
 * One interpretation of a run's `w:rPr` flags and values, shared by the paint
 * layer, the control-state reader and the saved-history reader so the toolbar
 * cannot report a state the document does not paint or undo.
 *
 * Two rules keep the reads honest:
 *
 * - A tracked change stores its history in a nested `w:rPrChange/w:rPr`, so the
 *   current properties are read after that subtree is dropped. Reading the
 *   fragments wholesale finds a historical element when the current one is
 *   absent and reports a value the document no longer has.
 * - A flag is off for `0`, `false` and `off`, and an enum value is matched
 *   case-insensitively to the contract's canonical option. Word's own writer
 *   may spell these differently from the contract.
 */

const RUN_HISTORY_ELEMENTS = new Set(['rPrChange'])
const PARAGRAPH_HISTORY_ELEMENTS = new Set(['rPrChange', 'pPrChange'])

/**
 * The run properties with any tracked history removed. A tracked change
 * stores a nested historical `w:rPr` under `w:rPrChange`, so the current
 * properties are read after that element is spliced out.
 */
export function withoutTrackedRunProperties(xml: string): string {
  return withoutTrackedHistory(xml, RUN_HISTORY_ELEMENTS)
}

/**
 * The same read for paragraph-level fragments: a `w:pPrChange` holds the
 * previous `w:pPr` — including the paragraph-mark `w:rPr` — so it is history
 * exactly as `w:rPrChange` is for a run.
 */
export function withoutTrackedParagraphProperties(xml: string): string {
  return withoutTrackedHistory(xml, PARAGRAPH_HISTORY_ELEMENTS)
}

type ScannedTag = {
  qualifiedName: string
  localName: string
  close: boolean
  selfClosing: boolean
}

/**
 * Splice the tracked-change elements out of a fragment by scanning tags
 * quote-aware rather than pairing by indexOf — a `/>` open drops only its own
 * tag, a paired open drops to its own depth-matched close, and an unclosed
 * change consumes the fragment's tail because everything after its open is
 * inside the element. A `>` inside an attribute value never ends a tag. A
 * tag-strip regex would be the incomplete-sanitization shape CodeQL flags, so
 * the scan is index-based on the shared `findXmlTagEnd` lexer. Malformed tags
 * that never close keep the remainder verbatim: their extent is unknowable.
 */
function withoutTrackedHistory(
  xml: string,
  names: ReadonlySet<string>,
): string {
  let result = ''
  let kept = 0
  let scan = 0
  for (;;) {
    const opening = xml.indexOf('<', scan)
    if (opening === -1) return result + xml.slice(kept)
    const end = tagEnd(xml, opening)
    if (end === undefined) return result + xml.slice(kept)
    const tag = scanTag(xml, opening, end)
    if (!tag || tag.close || !names.has(tag.localName)) {
      scan = end
      continue
    }
    result += xml.slice(kept, opening)
    kept = scan = tag.selfClosing
      ? end
      : changeElementEnd(xml, end, tag.qualifiedName)
  }
}

/**
 * The position one past the matching close of the element whose open tag ends
 * at `openEnd`, or the fragment's end when the element never closes — an
 * unclosed change wraps the rest of the fragment, which is all history.
 */
function changeElementEnd(
  xml: string,
  openEnd: number,
  qualifiedName: string,
): number {
  let depth = 1
  let cursor = openEnd
  for (;;) {
    const opening = xml.indexOf('<', cursor)
    if (opening === -1) return xml.length
    const end = tagEnd(xml, opening)
    if (end === undefined) return xml.length
    const tag = scanTag(xml, opening, end)
    if (tag?.qualifiedName === qualifiedName) {
      if (tag.close) {
        depth -= 1
        if (depth === 0) return end
      } else if (!tag.selfClosing) {
        depth += 1
      }
    }
    cursor = end
  }
}

/** The tag or construct opening at `index` ends here; undefined when unclosed. */
function tagEnd(xml: string, index: number): number | undefined {
  if (xml.startsWith('<!--', index)) return markerEnd(xml, '-->', index + 4)
  if (xml.startsWith('<![CDATA[', index))
    return markerEnd(xml, ']]>', index + 9)
  if (xml.startsWith('<?', index)) return markerEnd(xml, '?>', index + 2)
  try {
    return findXmlTagEnd(xml, index + 1)
  } catch {
    return undefined
  }
}

function markerEnd(xml: string, marker: string, from: number) {
  const index = xml.indexOf(marker, from)
  return index === -1 ? undefined : index + marker.length
}

function scanTag(
  xml: string,
  opening: number,
  end: number,
): ScannedTag | undefined {
  const body = xml.slice(opening + 1, end - 1)
  if (body.startsWith('!') || body.startsWith('?')) return undefined
  const close = body.startsWith('/')
  const name = /^[^\s/>]+/u.exec(close ? body.slice(1) : body)?.[0]
  if (!name) return undefined
  return {
    qualifiedName: name,
    localName: name.slice(name.indexOf(':') + 1),
    close,
    selfClosing: !close && /\/\s*$/u.test(body),
  }
}

function xmlPrefix(xml: string): string {
  return xml.match(/<([A-Za-z_][\w.-]*):/u)?.[1] ?? 'w'
}

/**
 * An attribute's value, matched only at an attribute boundary so a name that
 * merely ends in `val` (`w:interval`, `x:val`) cannot answer for `w:val`.
 */
function wordAttr(attrs: string | undefined, name: string, prefix: string) {
  return attrs?.match(
    new RegExp(`(?:^|\\s)(?:${prefix}:)?${name}="([^"]+)"`, 'i'),
  )?.[1]
}

/**
 * The attributes of the first `<prefix:localName>` tag. The tag end is scanned
 * quote-aware because `>` is legal inside an attribute value; an unclosed tag
 * reads as absent.
 */
function tagAttrs(
  xml: string,
  prefix: string,
  localName: string,
): string | undefined {
  const open = new RegExp(`<${prefix}:${localName}(?=[\\s/>])`, 'i').exec(xml)
  if (!open) return undefined
  const end = tagEnd(xml, open.index)
  return end === undefined
    ? undefined
    : xml.slice(open.index + open[0].length, end - 1)
}

function lowercaseValue(
  xml: string,
  prefix: string,
  localName: string,
): string | undefined {
  return wordAttr(
    tagAttrs(xml, prefix, localName),
    'val',
    prefix,
  )?.toLowerCase()
}

function optionOf<T extends string>(
  options: readonly T[],
  value: string | undefined,
): T | null {
  if (!value) return null
  const lower = value.toLowerCase()
  return options.find((option) => option.toLowerCase() === lower) ?? null
}

/** A run flag: `null` when the current `rPr` does not set it. */
export function runFlag(xml: string, localName: string): boolean | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  if (tagAttrs(current, prefix, localName) === undefined) return null
  const value = lowercaseValue(current, prefix, localName)
  return value !== '0' && value !== 'false' && value !== 'off'
}

/** Underline is a value, not a toggle: `none` is the explicit release. */
export function runUnderline(xml: string): boolean | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  if (tagAttrs(current, prefix, 'u') === undefined) return null
  const value = lowercaseValue(current, prefix, 'u')
  return value !== 'none' && value !== '0' && value !== 'false'
}

export function runHighlight(xml: string): HighlightValue | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  return optionOf(
    documentEditHighlightSchema.options,
    lowercaseValue(current, prefix, 'highlight'),
  )
}

export function runVertAlign(xml: string): VertAlignValue | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  return optionOf(
    documentEditVertAlignSchema.options,
    lowercaseValue(current, prefix, 'vertAlign'),
  )
}
