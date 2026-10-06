import type {
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import type { StructuralDraft } from './document-structural-drafts'

/** A run's [start, end) span in the paragraph's effective text. */
export type ParagraphRunSpan = { start: number; end: number }

/** The fields of a structural draft the conflict rule reads. */
export type StructuralPlacement =
  | { kind: 'table'; paragraphId: string }
  | { kind: 'image' | 'cross-reference'; paragraphId: string; offset: number }
  | { kind: 'link'; paragraphId: string; from: number; to: number }

/**
 * The paragraph's run boundaries in effective-text coordinates: a typed draft
 * replaces its run's text and the appended tail joins the last run, matching
 * the text the save writers compose over. A pending picture splits a run in
 * the painted wire, but the server still anchors the whole stored run, so
 * spans derive from the stored runs and the drafted text — never the painted
 * wire.
 */
export function structuralRunSpans(
  paragraph: DocumentParagraphWire,
  drafts: Record<string, string>,
  extraRuns: readonly DocumentTextRunWire[],
): ParagraphRunSpan[] {
  const tail = extraRuns.map((run) => drafts[run.id] ?? run.text).join('')
  const spans: ParagraphRunSpan[] = []
  let cursor = 0
  for (const [index, run] of paragraph.runs.entries()) {
    let length = (drafts[run.id] ?? run.text).length
    if (index === paragraph.runs.length - 1) length += tail.length
    spans.push({ start: cursor, end: cursor + length })
    cursor += length
  }
  return spans
}

/**
 * Whether `later` cannot compose with `earlier` inside one paragraph's saved
 * XML — verified against `applyDocumentEdits`. A link rewrites every run its
 * range touches; a picture or `REF` field splices zero-width content into one
 * run. A second edit that lands in a run already holding markup the overlay
 * fold cannot re-read — a `w:hyperlink` wrap or a field — is refused
 * `invalid-document-edit` at save, and a link cannot start over a pending
 * field. A pending picture folds back out, and a table is block-level, so
 * neither conflicts. The check is deliberately order-aware: `earlier` is the
 * draft already held, `later` the one being added.
 */
export function structuralDraftConflict(
  spans: readonly ParagraphRunSpan[],
  earlier: StructuralPlacement,
  later: StructuralPlacement,
): boolean {
  if (earlier.kind === 'link') {
    if (later.kind === 'table') return false
    const covered = coveredRuns(spans, earlier)
    if (later.kind === 'link') {
      return coveredRuns(spans, later).some((run) => covered.includes(run))
    }
    // A splice strictly inside a covered run meets the pending wrap; at a run
    // boundary it lands in the gap between run elements and composes.
    return insideAnyRun(covered, later.offset)
  }
  if (later.kind === 'link') {
    if (earlier.kind === 'table') return false
    const covered = coveredRuns(spans, later)
    if (earlier.kind === 'cross-reference') {
      // The field's zero-width splice counts as pending on the run it opens
      // at, so a boundary offset poisons the following run too.
      const occupied = occupiedRun(spans, earlier.offset)
      return occupied !== undefined && covered.includes(occupied)
    }
    return insideAnyRun(covered, earlier.offset)
  }
  if (earlier.kind === 'cross-reference' && later.kind !== 'table') {
    // A second splice strictly inside the field's run cannot fold the field
    // markup; the run's boundaries land in the gap and compose.
    const run = occupiedRun(spans, earlier.offset)
    return (
      run !== undefined && run.start < later.offset && later.offset < run.end
    )
  }
  return false
}

/**
 * The first draft already held on `paragraph` that `candidate` cannot compose
 * with, or undefined. `paragraph` is the stored wire — spans are derived
 * under the same effective text the save writers see.
 */
export function conflictingStructure(
  paragraph: DocumentParagraphWire,
  drafts: Record<string, string>,
  extraRuns: readonly DocumentTextRunWire[],
  held: readonly StructuralDraft[],
  candidate: StructuralPlacement,
): StructuralDraft | undefined {
  const spans = structuralRunSpans(paragraph, drafts, extraRuns)
  return held.find(
    (earlier) =>
      earlier.paragraphId === candidate.paragraphId &&
      structuralDraftConflict(spans, earlier, candidate),
  )
}

/** The noun a blocked-structure reason names the earlier draft with. */
export function structuralKindNoun(kind: StructuralPlacement['kind']) {
  switch (kind) {
    case 'table':
      return 'table'
    case 'image':
      return 'picture'
    case 'link':
      return 'hyperlink'
    case 'cross-reference':
      return 'cross-reference'
  }
}

/** Runs whose text span intersects the link's [from, to) range. */
function coveredRuns(
  spans: readonly ParagraphRunSpan[],
  link: { from: number; to: number },
) {
  return spans.filter((span) => span.start < link.to && span.end > link.from)
}

/**
 * The run an offset lands in: a boundary offset belongs to the run it opens,
 * and the paragraph end belongs to none — matching where the writers'
 * zero-width splices land relative to the run elements.
 */
function occupiedRun(spans: readonly ParagraphRunSpan[], offset: number) {
  return spans.find((span) => span.start <= offset && offset < span.end)
}

function insideAnyRun(spans: readonly ParagraphRunSpan[], offset: number) {
  return spans.some((span) => span.start < offset && offset < span.end)
}
