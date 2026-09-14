/**
 * The one neutral-citation grammar. Two layers must agree on what a neutral
 * citation is: `packages/app-shell` scans draft prose for candidates, and
 * Verify's citation resolution (V3) validates an already-extracted candidate
 * before it looks the citation up. A second copy would let extraction and
 * resolution disagree about which string names a judgment, so the grammar
 * lives here and both callers build their pattern from it.
 *
 * The court codes are a closed list of the courts the stored corpus is drawn
 * from. A code outside it is not a neutral citation here, so it is never
 * resolved as one.
 */

const neutralCitationCourts = String.raw`(?:UKSC|UKHL|UKPC|EWCA(?:\s+Civ|\s+Crim)?|EWHC(?:\s+\([A-Za-z]+\))?|EWFC|EWCOP|UKUT(?:\s+\([A-Za-z]+\))?|UKFTT(?:\s+\([A-Za-z]+\))?|CSIH|CSOH|NICA|NIQB)`

/**
 * The grammar as a pattern source, unanchored and case-sensitive: extraction
 * scans running prose, where a lowercased court code is a mention to keyword
 * search rather than a citation to link, and the caller decides the flags.
 */
export const neutralCitationPatternSource = String.raw`\[(?:18|19|20)\d{2}]\s+${neutralCitationCourts}\s+\d+(?:\s+\([A-Za-z]+\))?`

/**
 * A whole candidate, anchored at both ends. Case-insensitive because the
 * exact-comparison fold this resolution feeds (`normalizeCitationValue`) is
 * case-insensitive: a candidate differing only in case names the same
 * citation, so refusing it here would contradict the fold that matches it.
 */
const neutralCitationCandidatePattern = new RegExp(
  `^(?:${neutralCitationPatternSource})$`,
  'i',
)

/**
 * Control, format, surrogate and private-use characters, all of which can make
 * a string that is not the citation it appears to be: a bidi override can
 * reverse what a reviewer reads, and a zero-width joiner can hide a missing
 * space. A tab is the one exception, because the shared folds treat it as
 * whitespace.
 */
const refusedCharacters = /[\p{C}]/u

function hasRefusedCharacter(value: string): boolean {
  for (const character of value) {
    if (character !== '\t' && refusedCharacters.test(character)) return true
  }
  return false
}

/**
 * A raw candidate as a single neutral citation, or null when the candidate is
 * outside the grammar (a malformed bracket, a missing year, court or number,
 * appended prose, two citations in one candidate, non-ASCII digits, a Unicode
 * lookalike or a hidden control character). The returned string is the trimmed
 * candidate: surrounding whitespace is not part of the citation.
 *
 * Deliberately no folding beyond the trim happens before the grammar runs. The
 * store comparison later NFKC-folds its input, so a fullwidth bracket or a
 * fullwidth digit would otherwise be accepted here and silently matched
 * against a citation nobody typed.
 */
export function parseNeutralCitationCandidate(value: string): string | null {
  const trimmed = value.trim()
  if (hasRefusedCharacter(trimmed)) return null
  return neutralCitationCandidatePattern.test(trimmed) ? trimmed : null
}
