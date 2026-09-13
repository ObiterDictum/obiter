import type { LegislationScheduleGuidance } from './searchTypes'

export interface LegislationScheduleGuidanceFeedback {
  eyebrow: string
  title: string
  body: string
}

/**
 * Corrective copy for an underspecified schedule citation, derived from the
 * structured API diagnostic rather than the server's free-text note. Names
 * the missing schedule, shows the parser-compatible example, and keeps the
 * Act context so a resubmission resolves.
 */
export function getLegislationScheduleGuidanceFeedback(
  guidance: LegislationScheduleGuidance,
): LegislationScheduleGuidanceFeedback {
  const act = guidance.actTitle
  const body = guidance.example
    ? `This citation names a schedule paragraph but no schedule, so it cannot be resolved. Name the schedule, for example "${guidance.example}" with ${act}.`
    : `This citation names a schedule paragraph but no schedule, so it cannot be resolved against ${act}. Add the schedule number to resolve it.`
  return {
    eyebrow: 'Legislation citation incomplete',
    title: 'Name the schedule for this citation',
    body,
  }
}

/**
 * The citation to resubmit: the API's path-derived example plus the Act it
 * belongs to. Null when the label path carried no example to name.
 */
export function getLegislationScheduleResubmitQuery(
  guidance: LegislationScheduleGuidance,
): string | null {
  if (!guidance.example) return null
  return `${guidance.example} ${guidance.actTitle}`
}
