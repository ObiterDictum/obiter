/** Kind of a legislation row: the CLML element tag for provisions (P1..P5)
 * or the container name for the hierarchy levels (part, chapter, schedule,
 * crossheading). Mirrors LegislationProvisionKind in the ingestor's
 * legislation-clml.ts; services must not import each other, and this is the
 * one shape the Act page depends on for tree building. */
export type LegislationProvisionKind =
  | 'part'
  | 'chapter'
  | 'schedule'
  | 'crossheading'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5'

export function isContainerKind(kind: LegislationProvisionKind): boolean {
  return (
    kind === 'part' ||
    kind === 'chapter' ||
    kind === 'schedule' ||
    kind === 'crossheading'
  )
}
