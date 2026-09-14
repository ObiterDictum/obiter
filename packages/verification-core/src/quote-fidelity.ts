import type { CitationInput, NormalizedCitation } from './citation'
import type { EvidenceReference } from './evidence'
import {
  createVerificationFindingId,
  verificationFindingSchema,
  type FindingConfidence,
  type FindingSeverity,
  type VerificationFinding,
} from './finding'
import {
  compareQuoteText,
  type QuoteDifference,
  type QuoteTextOutcome,
} from './quote-text'
import type { VerificationSubject } from './subject'

/**
 * The quotation's own draft span. It is the same verbatim half-open slice
 * `CitationInput` describes (raw text plus a UTF-16 `DraftLocation`, length
 * pinned), reused rather than redefined so a quotation cannot carry a different
 * offset convention. V4's finding records the quotation in its `citation`
 * field: V1 keys `createVerificationFindingId` on that field's location, and
 * keying a quotation on the citation's location instead would collide for two
 * quotations attributed to the same citation occurrence.
 */
export type QuoteSpan = CitationInput

/**
 * One addressable stored source fragment, already read by the store boundary.
 * It carries the source text only in memory for the comparison; the evidence it
 * becomes holds ids and positions, never the text.
 */
export type QuoteFragment =
  | {
      sourceType: 'judgment'
      sourceId: string
      /** 1-based position in the document's paragraph array. */
      ordinal: number
      /** Printed number, when the judgment shows one. Display only. */
      paragraphNumber: number | null
      text: string
    }
  | {
      sourceType: 'legislation_provision'
      sourceId: string
      labelPath: string
      text: string
    }

/**
 * Why the store boundary could not supply a trustworthy fragment set. The
 * categories stay distinct so an operational caller can tell an outage from a
 * withdrawn source from an absent provision without reading the explanation.
 */
export type QuoteSourceUnavailableReason =
  | 'source_not_held'
  | 'source_withdrawn'
  | 'source_malformed'
  | 'source_unreadable'
  | 'identity_mismatch'
  | 'no_addressable_provision'
  | 'missing_provision'
  | 'citation_underspecified'
  | 'source_text_unverified'
  | 'no_source_fragments'
  | 'source_too_large'

/**
 * What the store boundary read for a resolved citation. `ready` carries the
 * fragments V2 judged trustworthy; `unavailable` says why none could be used;
 * `not_checked` says no source read ran because the citation never resolved.
 * V4 cannot compare against anything but `ready`, so a withdrawn, absent,
 * ambiguous or malformed source cannot enter the comparison.
 */
export type QuoteSourceOutcome =
  | { outcome: 'ready'; fragments: QuoteFragment[] }
  | { outcome: 'unavailable'; reason: QuoteSourceUnavailableReason }
  | { outcome: 'not_checked' }

/** Every way a quote comparison can fail to conclude. */
export type QuoteInconclusiveReason =
  | QuoteSourceUnavailableReason
  | 'citation_unresolved'
  | 'citation_ambiguous'
  | 'empty_quote'
  | 'passage_not_located'
  | 'passage_ambiguous'
  | 'quote_elided'

/**
 * The comparison result. It is deliberately separate from the V1 finding: it
 * says what the comparison established, and `decideQuoteFidelity` maps it onto
 * the finding vocabulary. A mismatch is only ever produced by a unique
 * anchored alignment naming real fragments, so it is a positive claim the
 * evidence supports; everything the comparison could not establish is
 * `inconclusive`.
 */
export type QuoteComparison =
  | { outcome: 'match'; exact: boolean; fragments: QuoteFragment[] }
  | {
      outcome: 'mismatch'
      difference: QuoteDifference
      fragments: QuoteFragment[]
    }
  | { outcome: 'inconclusive'; reason: QuoteInconclusiveReason }
  | { outcome: 'not_checked' }

export interface QuoteFidelityInput {
  subject: VerificationSubject
  quote: QuoteSpan
  normalizedCitation: NormalizedCitation
  source: QuoteSourceOutcome
}

/** A resolved citation, the only citation state a comparison can act on. */
type ResolvedCitation = Extract<
  NormalizedCitation,
  { kind: 'case_law' | 'legislation' }
>

/**
 * Handed a fragment from another source than the resolved citation. This is a
 * programmer error in the store boundary, not a check outcome, so it fails
 * loudly rather than being reported as an inconclusive comparison. It is the
 * guard that stops a quote for one authority being "verified" against another.
 */
export class QuoteSourceMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuoteSourceMismatchError'
  }
}

/**
 * Every fragment must belong to the resolved citation's own source, and the
 * count must match the granularity the citation addresses: one judgment
 * document's paragraphs, or exactly one provision. A whole-document reference
 * cannot satisfy a quote check because a quote needs inside the document, and a
 * provision citation is scoped to the one provision it names.
 */
function assertFragmentsMatchCitation(
  citation: ResolvedCitation,
  fragments: readonly QuoteFragment[],
): void {
  for (const fragment of fragments) {
    if (citation.kind === 'case_law') {
      if (
        fragment.sourceType !== 'judgment' ||
        fragment.sourceId !== citation.sourceId
      ) {
        throw new QuoteSourceMismatchError(
          'A quote fragment must be a judgment paragraph of the resolved case-law citation.',
        )
      }
    } else if (
      citation.labelPath === null ||
      fragment.sourceType !== 'legislation_provision' ||
      fragment.sourceId !== citation.documentIdentity
    ) {
      throw new QuoteSourceMismatchError(
        'A quote fragment must be a provision of the resolved, provision-scoped legislation citation.',
      )
    }
  }

  if (citation.kind === 'legislation' && fragments.length !== 1) {
    throw new QuoteSourceMismatchError(
      'A legislation quote comparison must be scoped to exactly one provision fragment.',
    )
  }
}

function toComparison(
  result: QuoteTextOutcome,
  fragments: readonly QuoteFragment[],
): QuoteComparison {
  const selected = (indexes: readonly number[]): QuoteFragment[] => {
    const seen = new Set<QuoteFragment>()
    const chosen: QuoteFragment[] = []
    for (const index of indexes) {
      const fragment = fragments[index]
      if (fragment === undefined) {
        throw new QuoteSourceMismatchError(
          'A quote comparison named a fragment that was not supplied.',
        )
      }
      if (seen.has(fragment)) continue
      seen.add(fragment)
      chosen.push(fragment)
    }
    return chosen
  }

  switch (result.outcome) {
    case 'match':
      return {
        outcome: 'match',
        exact: result.exact,
        fragments: selected(result.fragmentIndexes),
      }
    case 'mismatch':
      return {
        outcome: 'mismatch',
        difference: result.difference,
        fragments: selected(result.fragmentIndexes),
      }
    case 'no_fragments':
      return { outcome: 'inconclusive', reason: 'no_source_fragments' }
    case 'empty_quote':
      return { outcome: 'inconclusive', reason: 'empty_quote' }
    case 'no_match':
      return { outcome: 'inconclusive', reason: 'passage_not_located' }
    case 'ambiguous':
      return { outcome: 'inconclusive', reason: 'passage_ambiguous' }
    case 'elided':
      return { outcome: 'inconclusive', reason: 'quote_elided' }
    default: {
      const unhandled: never = result
      return unhandled
    }
  }
}

/**
 * Compare a quotation against the stored fragments of the authority a V3
 * citation resolved to. It never reads a store, never re-resolves the citation
 * and never claims an authority exists: the only store state it acts on is the
 * trustworthy fragment set V2's assessment produced.
 */
export function compareQuote(input: QuoteFidelityInput): QuoteComparison {
  const citation = input.normalizedCitation
  if (citation.kind === 'not_checked') return { outcome: 'not_checked' }
  if (citation.kind === 'unresolved') {
    return {
      outcome: 'inconclusive',
      reason:
        citation.reason === 'ambiguous'
          ? 'citation_ambiguous'
          : 'citation_unresolved',
    }
  }
  if (input.source.outcome === 'not_checked') {
    throw new QuoteSourceMismatchError(
      'A resolved citation requires a source read outcome.',
    )
  }
  if (input.source.outcome === 'unavailable') {
    return { outcome: 'inconclusive', reason: input.source.reason }
  }

  assertFragmentsMatchCitation(citation, input.source.fragments)
  return toComparison(
    compareQuoteText(
      input.quote.rawText,
      input.source.fragments.map((fragment) => fragment.text),
    ),
    input.source.fragments,
  )
}

function fragmentEvidence(fragment: QuoteFragment): EvidenceReference {
  return fragment.sourceType === 'judgment'
    ? {
        sourceType: 'judgment',
        granularity: 'fragment',
        sourceId: fragment.sourceId,
        ordinal: fragment.ordinal,
        paragraphNumber: fragment.paragraphNumber,
      }
    : {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: fragment.sourceId,
        labelPath: fragment.labelPath,
      }
}

function mismatchExplanation(difference: QuoteDifference): string {
  return difference === 'punctuation'
    ? 'The stored passage contains the same words as the quotation but different punctuation or spacing, which can change legal meaning.'
    : 'The stored passage differs materially from the quotation in its wording.'
}

function inconclusiveExplanation(reason: QuoteInconclusiveReason): string {
  switch (reason) {
    case 'citation_unresolved':
      return 'The citation could not be resolved to a public source identity, so no quotation was compared.'
    case 'citation_ambiguous':
      return 'The citation is ambiguous, so no single public source was used for the quotation comparison.'
    case 'source_not_held':
      return 'Obiter does not hold a stored public source for the citation, so no quotation was compared.'
    case 'source_withdrawn':
      return 'The stored public source for the citation is withdrawn upstream, so the quotation was not compared against it.'
    case 'source_malformed':
      return 'A stored public source record could not be validated, so the quotation was not compared. This is not a mismatch.'
    case 'source_unreadable':
      return 'The stored public source record could not be read, so the quotation was not compared. This is not a mismatch.'
    case 'identity_mismatch':
      return "The citation's stored identity does not agree with the stored record, so the quotation was not compared."
    case 'no_addressable_provision':
      return 'The citation names a whole Act rather than a provision, so there is no addressable provision to compare the quotation against.'
    case 'missing_provision':
      return 'The Act is held, but the cited provision is not, so the quotation was not compared. This is an availability result, not a mismatch.'
    case 'citation_underspecified':
      return 'The Act is held, but the citation names no schedule the store can resolve without guessing, so the quotation was not compared.'
    case 'source_text_unverified':
      return 'The stored provision text is not a verified current version, so the quotation was not compared against it. This is not a mismatch.'
    case 'source_too_large':
      return 'The stored source exceeds the bounded size this check will compare against, so the quotation was not compared. This is not a mismatch.'
    case 'no_source_fragments':
      return 'The stored source holds no addressable fragment to compare the quotation against, so the check is inconclusive.'
    case 'empty_quote':
      return 'The quotation reduces to no comparable text, so the check is inconclusive rather than a mismatch.'
    case 'passage_not_located':
      return 'The corresponding stored passage could not be located, so the check is inconclusive rather than a mismatch.'
    case 'passage_ambiguous':
      return 'More than one stored passage could correspond to the quotation, so the check is inconclusive rather than a mismatch.'
    case 'quote_elided':
      return 'The quotation contains an ellipsis the source does not, so what was omitted cannot be checked and the result is inconclusive.'
    default: {
      const unhandled: never = reason
      return unhandled
    }
  }
}

function inconclusiveReviewReason(
  reason: QuoteInconclusiveReason,
):
  | 'citation_unresolved'
  | 'citation_ambiguous'
  | 'evidence_unavailable'
  | 'check_inconclusive' {
  switch (reason) {
    case 'citation_unresolved':
      return 'citation_unresolved'
    case 'citation_ambiguous':
      return 'citation_ambiguous'
    case 'source_not_held':
    case 'source_withdrawn':
    case 'no_addressable_provision':
    case 'missing_provision':
    case 'source_text_unverified':
    case 'no_source_fragments':
      return 'evidence_unavailable'
    default:
      return 'check_inconclusive'
  }
}

interface DecidedQuote {
  status: VerificationFinding['status']
  severity: FindingSeverity | null
  confidence: FindingConfidence | null
  evidence: EvidenceReference[]
  explanation: string
}

function decide(comparison: QuoteComparison): DecidedQuote {
  switch (comparison.outcome) {
    case 'not_checked':
      return {
        status: { state: 'not_checked' },
        severity: null,
        confidence: null,
        evidence: [],
        explanation: 'The quote fidelity check did not run.',
      }
    case 'match':
      return {
        status: { state: 'clear' },
        severity: 'low',
        confidence: comparison.exact ? 'high' : 'medium',
        evidence: comparison.fragments.map(fragmentEvidence),
        explanation:
          'The quotation appears in the stored public source as quoted.',
      }
    case 'mismatch':
      return {
        status: { state: 'flagged' },
        severity: 'high',
        confidence: 'high',
        evidence: comparison.fragments.map(fragmentEvidence),
        explanation: mismatchExplanation(comparison.difference),
      }
    case 'inconclusive':
      return {
        status: {
          state: 'review_required',
          reason: inconclusiveReviewReason(comparison.reason),
        },
        severity: 'medium',
        confidence: 'low',
        evidence: [],
        explanation: inconclusiveExplanation(comparison.reason),
      }
    default: {
      const unhandled: never = comparison
      return unhandled
    }
  }
}

/**
 * One quote-fidelity finding for a quotation and a source read. The returned
 * value is an accepted V1 finding state, so a caller cannot wrap the outcome in
 * a status the truth table refuses: a proven mismatch always carries the
 * fragment that shows it, and an unavailable or unaddressable comparison can
 * never be reported as a mismatch.
 */
export function decideQuoteFidelity(
  input: QuoteFidelityInput,
): VerificationFinding {
  const decided = decide(compareQuote(input))
  return verificationFindingSchema.parse({
    id: createVerificationFindingId({
      subject: input.subject,
      type: 'quote_fidelity',
      location: input.quote.location,
    }),
    type: 'quote_fidelity',
    subject: input.subject,
    citation: input.quote,
    normalizedCitation: input.normalizedCitation,
    status: decided.status,
    severity: decided.severity,
    confidence: decided.confidence,
    evidence: decided.evidence,
    explanation: decided.explanation,
  })
}
