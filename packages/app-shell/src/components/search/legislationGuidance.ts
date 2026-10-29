import type { LegislationScheduleGuidance } from './searchTypes'

export interface LegislationScheduleGuidanceFeedback {
  eyebrow: string
  title: string
  body: string
}

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

export function getLegislationScheduleResubmitQuery(
  guidance: LegislationScheduleGuidance,
): string | null {
  if (!guidance.example) return null
  return `${guidance.example} ${guidance.actTitle}`
}
