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
