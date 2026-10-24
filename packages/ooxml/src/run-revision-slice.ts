import { hasPropertyRevision } from './run-revision-eligibility'
import type { DocumentTextRunWire } from '@obiter/contracts'

/** Splices cut after controls; range edits cut before controls at the boundary. */
export function sliceRunRevisionMetadata(
  run: DocumentTextRunWire,
  from: number,
  to: number,
  fragments: readonly string[] = run.preservedXmlFragments,
  boundaryControls: 'head' | 'tail' | 'both' = 'head',
) {
  if (run.textRevisionEligible && !hasPropertyRevision(fragments))
    return { textRevisionEligible: true }
  const tokens = (run.textRevisionTokens ?? [])
    .filter((token) =>
      boundaryControls === 'both'
        ? token.offset >= from && token.offset <= to
        : boundaryControls === 'tail'
          ? token.offset >= from &&
            (token.offset < to || to === run.text.length)
          : (token.offset > from || from === 0) && token.offset <= to,
    )
    .map((token) => ({ ...token, offset: token.offset - from }))
  const ranges = run.textRevisionTextRanges ?? [
    { from: 0, to: run.text.length },
  ]
  const kept = ranges.filter((range) => range.to > from && range.from < to)
  const firstIndex = kept.length
    ? ranges.findIndex((range) => range === kept[0])
    : 0
  return {
    textRevisionEligible: false,
    textRevisionTokens: tokens.map((token) => ({
      ...token,
      textIndex: Math.max(0, token.textIndex - firstIndex),
    })),
    textRevisionTextRanges: kept.map((range) => ({
      from: Math.max(0, range.from - from),
      to: Math.min(to, range.to) - from,
    })),
  }
}
