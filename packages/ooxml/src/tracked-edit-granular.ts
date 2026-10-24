import { planTextRevision } from '@obiter/contracts'
import { splittableRunParts } from './run-revision-eligibility'
import type { TextRunAnchor } from './model'
import {
  textElementXmlSpaceAttribute,
  wordRunInnerTextXml,
} from './text-run-edit'
import { escapeXmlText } from './parts/overlay'

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
  const run = splittableRunParts(source, anchor)
  if (!run) return { kind: 'fallback' }
  const { removed, inserted } = middle

  const runClose = `</${prefix}:r>`
  const rpr = run.rpr ?? ''
  const unchangedRun = (piece: string) =>
    `${run.open}${rpr}<${prefix}:t${textElementXmlSpaceAttribute(piece)}>${escapeXmlText(piece)}</${prefix}:t>${runClose}`
  const pieces: Extract<GranularRunEdit, { kind: 'pieces' }> = {
    kind: 'pieces',
  }
  if (middle.prefixLength > 0) {
    pieces.prefixRun = unchangedRun(
      anchor.wire.text.slice(0, middle.prefixLength),
    )
  }
  if (middle.suffixLength > 0) {
    pieces.suffixRun = unchangedRun(
      anchor.wire.text.slice(anchor.wire.text.length - middle.suffixLength),
    )
  }
  if (removed !== '') {
    pieces.deletedRun = `${run.open}${rpr}<${prefix}:delText${textElementXmlSpaceAttribute(removed)}>${escapeXmlText(removed)}</${prefix}:delText>${runClose}`
  }
  if (inserted !== '') {
    pieces.insertedRun = `${run.open}${rpr}${wordRunInnerTextXml(prefix, inserted)}${runClose}`
  }
  return pieces
}
