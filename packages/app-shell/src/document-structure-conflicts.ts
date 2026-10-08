import type {
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import type { StructuralDraft } from './document-structural-drafts'

/** A run's [start, end) span in the paragraph's effective text. */
export type ParagraphRunSpan = { start: number; end: number }

/** The fields of a structural draft the conflict rule reads. Each kind owns
 * its member so the kind discriminant narrows cleanly. */
export type StructuralPlacement =
  | { kind: 'table'; paragraphId: string }
  | { kind: 'image'; paragraphId: string; offset: number }
  | {
      kind:
        | 'cross-reference'
        | 'page-number'
        | 'footnote'
        | 'table-of-contents'
        | 'table-of-authorities'
        | 'authority-mark'
      paragraphId: string
      offset: number
    }
  | { kind: 'link'; paragraphId: string; from: number; to: number }
  | { kind: 'defined-term'; paragraphId: string; from: number; to: number }
  /**
   * A refresh claims a field's whole generated range rather than a point,
   * so it has no offset: its conflicts are range-level and live with the
   * update predicates, not here.
   */
  | { kind: 'table-of-authorities-refresh'; paragraphId: string }

type RangePlacement = Extract<StructuralPlacement, { from: number }>
type SplicePlacement = Extract<
  StructuralPlacement,
  {
    kind:
      | 'cross-reference'
      | 'page-number'
      | 'footnote'
      | 'table-of-contents'
      | 'table-of-authorities'
      | 'authority-mark'
  }
>

/**
 * A range mark over `[from, to)`: a `w:hyperlink` wrap or a `_Def_` bookmark
 * pair. Both write markup whose ends sit at the range boundaries, so a splice
 * inside the covered text composes while a boundary inside another mark's
 * covered run meets pending structure.
 */
function isRangeMark(
  placement: StructuralPlacement,
): placement is RangePlacement {
  return placement.kind === 'link' || placement.kind === 'defined-term'
}

/**
 * A zero-width splice at one offset. A `REF` field, a `PAGE` field, a
 * footnote reference, a `TOC` field, a `TOA` field and the hidden `TA`
 * marks a table of authorities writes into citing paragraphs share the
 * same shape — a run cut open for element-only content — so they share
 * the conflict rules: each poisons strictly-inside splices on the run it
 * lands in.
 */
function isZeroWidthSplice(
  placement: StructuralPlacement,
): placement is SplicePlacement {
  return (
    placement.kind === 'cross-reference' ||
    placement.kind === 'page-number' ||
    placement.kind === 'footnote' ||
    placement.kind === 'table-of-contents' ||
    placement.kind === 'table-of-authorities' ||
    placement.kind === 'authority-mark'
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
  // A refresh's claim is the field's covered paragraphs, not a splice
  // point: the offset rules have nothing to say to it, and the range
  // coverage the update predicates own is what refuses the pair.
  if (
    earlier.kind === 'table-of-authorities-refresh' ||
    later.kind === 'table-of-authorities-refresh'
  ) {
    return false
  }
  if (isRangeMark(earlier)) {
    if (later.kind === 'table') return false
    const covered = coveredRuns(spans, earlier)
    if (isRangeMark(later)) {
      if (earlier.kind === 'defined-term' && later.kind === 'defined-term') {
        // Two marks sharing a covered run write overlapping replacements the
        // overlay cannot serialise; in disjoint runs only a crossing range
        // would pair the terms' bookmarks over the same words.
        return (
          coveredRuns(spans, later).some((run) => covered.includes(run)) ||
          (earlier.from < later.to && later.from < earlier.to)
        )
      }
      if (later.kind === 'defined-term') {
        // A mark boundary strictly inside a run the link rewrites cuts that
        // run, and two replacements cannot cover one range. At a run's edges
        // the pair lands beside the link element and composes — a bookmark
        // around a `w:hyperlink` is legal OOXML.
        return covered.some(
          (span) =>
            strictlyInside(span, later.from) || strictlyInside(span, later.to),
        )
      }
      return coveredRuns(spans, later).some((run) => covered.includes(run))
    }
    if (earlier.kind === 'link') {
      // A splice strictly inside a covered run meets the pending wrap; at a
      // run boundary it lands in the gap between run elements and composes.
      return insideAnyRun(covered, later.offset)
    }
    // Only the runs the mark cuts are rewritten: a splice strictly inside one
    // overlaps the mark's pending replacement; inside a wholly covered run or
    // at a boundary it composes.
    return insideAnyRun(markCutRuns(covered, earlier), later.offset)
  }
  if (isRangeMark(later)) {
    if (earlier.kind === 'table') return false
    if (later.kind === 'defined-term') {
      // A field or picture splice strictly inside a run the mark cuts cannot
      // fold: the mark's materialisation of the run's pending content would
      // read more than one element.
      const cut = markCutRuns(coveredRuns(spans, later), later)
      return insideAnyRun(cut, earlier.offset)
    }
    const covered = coveredRuns(spans, later)
    if (isZeroWidthSplice(earlier)) {
      // The field's zero-width splice counts as pending on the run it opens
      // at, so a boundary offset poisons the following run too.
      const occupied = occupiedRun(spans, earlier.offset)
      return occupied !== undefined && covered.includes(occupied)
    }
    return insideAnyRun(covered, earlier.offset)
  }
  if (isZeroWidthSplice(earlier) && later.kind !== 'table') {
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
    case 'table-of-authorities':
      return 'table of authorities'
    case 'table-of-authorities-refresh':
      return 'table of authorities update'
    case 'authority-mark':
      return 'citation mark'
    case 'defined-term':
      return 'defined-term mark'
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
  if (
    candidate.kind !== 'image' &&
    candidate.kind !== 'defined-term' &&
    !isZeroWidthSplice(candidate)
  ) {
    return undefined
  }
  // A defined-term mark writes its pair at the range boundaries: an end
  // landing inside a stored link's element is the same refused splice a
  // field's offset makes. `from` counts inside a linked run it opens (the
  // pair's start would land between the element's tags); `to` counts through
  // the run's end edge, the writer's `endInside` test.
  const index = spans.findIndex((span, runIndex) => {
    if (paragraph.runs[runIndex]?.hyperlinkTarget === undefined) return false
    if (candidate.kind === 'defined-term') {
      return (
        (span.start <= candidate.from && candidate.from < span.end) ||
        (span.start < candidate.to && candidate.to <= span.end)
      )
    }
    return span.start <= candidate.offset && candidate.offset < span.end
  })
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
 * The covered runs the mark rewrites: the boundary runs it cuts. A wholly
 * covered interior run keeps its stored element and stays composable — the
 * pair's halves land at the range's edges as insertions, not a rewrite.
 */
function markCutRuns(
  covered: readonly ParagraphRunSpan[],
  mark: { from: number; to: number },
) {
  return covered.filter((span) => span.start < mark.from || span.end > mark.to)
}

function strictlyInside(span: ParagraphRunSpan, offset: number) {
  return span.start < offset && offset < span.end
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
