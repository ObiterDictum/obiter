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
  | {
      kind:
        | 'image'
        | 'cross-reference'
        | 'page-number'
        | 'footnote'
        | 'table-of-contents'
      paragraphId: string
      offset: number
    }
  | { kind: 'link'; paragraphId: string; from: number; to: number }

/**
 * A zero-width splice at one offset. A `REF` field, a `PAGE` field, a
 * footnote reference and a `TOC` field share the same shape — a run cut
 * open for element-only content — so they share the conflict rules: each
 * poisons strictly-inside splices on the run it lands in.
 */
function isZeroWidthSplice(kind: StructuralPlacement['kind']) {
  return (
    kind === 'cross-reference' ||
    kind === 'page-number' ||
    kind === 'footnote' ||
    kind === 'table-of-contents'
  )
}

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
    if (isZeroWidthSplice(earlier.kind)) {
      // The field's zero-width splice counts as pending on the run it opens
      // at, so a boundary offset poisons the following run too.
      const occupied = occupiedRun(spans, earlier.offset)
      return occupied !== undefined && covered.includes(occupied)
    }
    return insideAnyRun(covered, earlier.offset)
  }
  if (
    earlier.kind !== 'table' &&
    isZeroWidthSplice(earlier.kind) &&
    later.kind !== 'table'
  ) {
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
 * The stored structure or first held draft on `paragraph` that `candidate`
 * cannot compose with, or undefined. `paragraph` is the stored wire — spans
 * are derived under the same effective text the save writers see. A stored
 * `w:hyperlink` predates every draft, so it is checked first: a splice
 * strictly inside a linked run would nest inside the element, silently making
 * the field's result or the picture part of the anchor text — the stored twin
 * of the pending-link rule.
 */
export function conflictingStructure(
  paragraph: DocumentParagraphWire,
  drafts: Record<string, string>,
  extraRuns: readonly DocumentTextRunWire[],
  held: readonly StructuralDraft[],
  candidate: StructuralPlacement,
): StructuralPlacement | undefined {
  const spans = structuralRunSpans(paragraph, drafts, extraRuns)
  return (
    storedLinkConflict(paragraph, spans, candidate) ??
    held.find(
      (earlier) =>
        earlier.paragraphId === candidate.paragraphId &&
        structuralDraftConflict(spans, earlier, candidate),
    )
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
    case 'page-number':
      return 'page number'
    case 'footnote':
      return 'footnote'
    case 'table-of-contents':
      return 'table of contents'
  }
}

/**
 * A splice at or inside a run whose wire carries a stored link's target
 * lands inside the `w:hyperlink` element — the leading boundary opens the
 * run's text element rather than landing between elements — so the span is
 * half-open here, matching the writer's element check exactly. Answered as
 * a link placement so the reason names a hyperlink.
 */
function storedLinkConflict(
  paragraph: DocumentParagraphWire,
  spans: readonly ParagraphRunSpan[],
  candidate: StructuralPlacement,
): StructuralPlacement | undefined {
  if (candidate.kind === 'table' || candidate.kind === 'link') {
    return undefined
  }
  if (candidate.kind !== 'image' && !isZeroWidthSplice(candidate.kind)) {
    return undefined
  }
  const index = spans.findIndex(
    (span, runIndex) =>
      paragraph.runs[runIndex]?.hyperlinkTarget !== undefined &&
      span.start <= candidate.offset &&
      candidate.offset < span.end,
  )
  const span = spans[index]
  return span === undefined
    ? undefined
    : {
        kind: 'link',
        paragraphId: candidate.paragraphId,
        from: span.start,
        to: span.end,
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
