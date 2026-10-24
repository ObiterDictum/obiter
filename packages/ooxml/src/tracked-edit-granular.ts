import { normaliseEditText, planTextRevision } from '@obiter/contracts'
import type { TextRunAnchor } from './model'
import { wordRunInnerTextXml } from './text-run-edit'
import { decodeXmlReferences } from './xml-lexemes'
import { rawOffsetAtDecodedBoundary } from './text-offsets'

/**
 * The granular tracked text replacement. The tracked-change writer in
 * tracked-edits.ts decides between this shape and the whole-run form; this
 * module only measures the changed middle and proves whether the run can be
 * split at it. Every function here is pure: it takes source XML and anchors,
 * and returns XML.
 */

export type GranularRunEdit =
  | {
      kind: 'pieces'
      prefixRun?: string
      deletedRun?: string
      insertedRun?: string
      suffixRun?: string
    }
  | { kind: 'noop' }
  | { kind: 'fallback' }

/**
 * The granular form of a tracked text replacement. The run splits at the
 * changed middle: an untouched run for the shared head, a `w:del` run holding
 * only the removed characters, a `w:ins` run holding only the inserted ones
 * and an untouched run for the shared tail — the shape Word itself writes,
 * and the shape legal review expects.
 *
 * Only a run whose content is safely splittable qualifies: an optional
 * `w:rPr` plus plain `w:t` children and no text-wrapping breaks. A run
 * carrying tabs, breaks, field characters, instructions, note or comment
 * references, drawings, bookmark or comment range markers, or any other
 * child falls back to the whole-run form — fail closed, because those
 * children carry identity or structure a blind split would duplicate.
 */
export function granularRunEdit(
  source: string,
  anchor: TextRunAnchor,
  text: string,
  prefix: string,
  pendingProperties = false,
): GranularRunEdit {
  const middle = planTextRevision(
    anchor.wire.text,
    text,
    anchor.wire.textRevisionEligible === true,
    anchor.wire.textRevisionTokens,
    pendingProperties,
    anchor.wire.textRevisionTextRanges?.length,
  )
  if (middle.kind === 'noop') return { kind: 'noop' }
  if (middle.kind === 'whole-run') return { kind: 'fallback' }
  const { inserted } = middle
  const original = anchor.wire.text
  const start = sourceBoundary(original, middle.prefixLength)
  const end = sourceBoundary(
    original,
    normaliseEditText(original).length - middle.suffixLength,
  )
  const runClose = `</${prefix}:r>`
  const open = source.slice(anchor.runRange.start, anchor.runRange.startTagEnd)
  const properties = anchor.runPropertiesRange
  const rpr = properties ? source.slice(properties.start, properties.end) : ''
  const sourceRun = (from: number, to: number, name = 't') => {
    let cursor = 0
    let raw = ''
    for (const element of anchor.textElements) {
      const content = source.slice(element.startTagEnd, element.endTagStart)
      const length = decodeXmlReferences(content).length
      const left = Math.max(0, from - cursor)
      const right = Math.min(length, to - cursor)
      if (left < right)
        raw += content.slice(
          rawOffsetAtDecodedBoundary(content, left),
          rawOffsetAtDecodedBoundary(content, right),
        )
      cursor += length
    }
    // Keep source lexemes, including CR references, even inside a deletion:
    // rejecting the revision must restore the exact original characters.
    const space = /^\s|\s$/u.test(decodeXmlReferences(raw))
      ? ' xml:space="preserve"'
      : ''
    return `${open}${rpr}<${prefix}:${name}${space}>${raw}</${prefix}:${name}>${runClose}`
  }
  const pieces: Extract<GranularRunEdit, { kind: 'pieces' }> = {
    kind: 'pieces',
  }
  if (start > 0) pieces.prefixRun = sourceRun(0, start)
  if (end < original.length) pieces.suffixRun = sourceRun(end, original.length)
  if (start < end) pieces.deletedRun = sourceRun(start, end, 'delText')
  if (inserted !== '') {
    pieces.insertedRun = `${open}${rpr}${wordRunInnerTextXml(prefix, inserted)}${runClose}`
  }
  return pieces
}

/** Map a comparison offset back across CRLF pairs in the source text. */
function sourceBoundary(source: string, offset: number) {
  let raw = 0
  for (let normalised = 0; normalised < offset; normalised += 1) {
    if (source[raw] === '\r' && source[raw + 1] === '\n') raw += 1
    raw += 1
  }
  return raw
}
