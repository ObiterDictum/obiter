const neutralCitationCourts = String.raw`(?:UKSC|UKHL|UKPC|EWCA(?:\s+Civ|\s+Crim)?|EWHC(?:\s+\([A-Za-z]+\))?|EWFC|EWCOP|UKUT(?:\s+\([A-Za-z]+\))?|UKFTT(?:\s+\([A-Za-z]+\))?|CSIH|CSOH|NICA|NIQB)`

export const neutralCitationPatternSource = String.raw`\[(?:18|19|20)\d{2}]\s+${neutralCitationCourts}\s+\d+(?:\s+\([A-Za-z]+\))?`

const neutralCitationCandidatePattern = new RegExp(
  `^(?:${neutralCitationPatternSource})$`,
  'i',
)

const unsupportedCourtCandidatePattern = new RegExp(
  String.raw`^\[(?:18|19|20)\d{2}]\s+[A-Za-z]{2,8}\s+\d+(?:\s+\([A-Za-z]+\))?$`,
  'i',
)

const refusedCharacters = /[\p{C}]/u

function hasRefusedCharacter(value: string): boolean {
  for (const character of value) {
    if (character !== '\t' && refusedCharacters.test(character)) return true
  }
  return false
}

export type NeutralCitationCandidateKind =
  'citation' | 'unsupported_court' | 'not_a_citation'

export function classifyNeutralCitationCandidate(
  value: string,
): NeutralCitationCandidateKind {
  const trimmed = value.trim()
  if (hasRefusedCharacter(trimmed)) return 'not_a_citation'
  if (neutralCitationCandidatePattern.test(trimmed)) return 'citation'
  return unsupportedCourtCandidatePattern.test(trimmed)
    ? 'unsupported_court'
    : 'not_a_citation'
}

export function parseNeutralCitationCandidate(value: string): string | null {
  const trimmed = value.trim()
  return classifyNeutralCitationCandidate(trimmed) === 'citation'
    ? trimmed
    : null
}
