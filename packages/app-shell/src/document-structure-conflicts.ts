import type {
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import type { StructuralDraft } from './document-structural-drafts'

type ParagraphRunSpan = { start: number; end: number }

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

function isRangeMark(
  placement: StructuralPlacement,
): placement is RangePlacement {
  return placement.kind === 'link' || placement.kind === 'defined-term'
}

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

function structuralRunSpans(
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

function structuralDraftConflict(
  spans: readonly ParagraphRunSpan[],
  earlier: StructuralPlacement,
  later: StructuralPlacement,
): boolean {
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
        return (
          coveredRuns(spans, later).some((run) => covered.includes(run)) ||
          (earlier.from < later.to && later.from < earlier.to)
        )
      }
      if (later.kind === 'defined-term') {
        return covered.some(
          (span) =>
            strictlyInside(span, later.from) || strictlyInside(span, later.to),
        )
      }
      return coveredRuns(spans, later).some((run) => covered.includes(run))
    }
    if (earlier.kind === 'link') {
      return insideAnyRun(covered, later.offset)
    }
    return insideAnyRun(markCutRuns(covered, earlier), later.offset)
  }
  if (isRangeMark(later)) {
    if (earlier.kind === 'table') return false
    if (later.kind === 'defined-term') {
      const cut = markCutRuns(coveredRuns(spans, later), later)
      return insideAnyRun(cut, earlier.offset)
    }
    const covered = coveredRuns(spans, later)
    if (isZeroWidthSplice(earlier)) {
      const occupied = occupiedRun(spans, earlier.offset)
      return occupied !== undefined && covered.includes(occupied)
    }
    return insideAnyRun(covered, earlier.offset)
  }
  if (isZeroWidthSplice(earlier) && later.kind !== 'table') {
    const run = occupiedRun(spans, earlier.offset)
    return (
      run !== undefined && run.start < later.offset && later.offset < run.end
    )
  }
  return false
}

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

function coveredRuns(
  spans: readonly ParagraphRunSpan[],
  link: { from: number; to: number },
) {
  return spans.filter((span) => span.start < link.to && span.end > link.from)
}

function markCutRuns(
  covered: readonly ParagraphRunSpan[],
  mark: { from: number; to: number },
) {
  return covered.filter((span) => span.start < mark.from || span.end > mark.to)
}

function strictlyInside(span: ParagraphRunSpan, offset: number) {
  return span.start < offset && offset < span.end
}

function occupiedRun(spans: readonly ParagraphRunSpan[], offset: number) {
  return spans.find((span) => span.start <= offset && offset < span.end)
}

function insideAnyRun(spans: readonly ParagraphRunSpan[], offset: number) {
  return spans.some((span) => span.start < offset && offset < span.end)
}
