import { formatDate } from './format'

import type { LegislationStatus } from '@obiter/contracts/legislation-reader'

export type { LegislationStatus }

export interface LegislationStatusDisplay {
  tone: 'success' | 'warning' | 'neutral'
  label: string
}

export function legislationStatusDisplay(
  status: LegislationStatus,
  repealedFrom?: string,
): LegislationStatusDisplay {
  if (status === 'repealed')
    return {
      tone: 'neutral',
      label: repealedFrom
        ? `Repealed from ${formatDate(repealedFrom)}`
        : 'Repealed',
    }
  if (status === 'amended_not_held')
    return { tone: 'warning', label: 'May not be up to date' }
  return { tone: 'success', label: 'No unapplied amendments' }
}

export function legislationCheckedLabel({
  effectsCheckedAt,
  effectsCheckedUntil,
  acquiredAt,
}: {
  effectsCheckedAt?: string
  effectsCheckedUntil?: string
  acquiredAt?: string
}): string {
  if (effectsCheckedAt) {
    const from = formatDate(effectsCheckedAt)
    const until = effectsCheckedUntil ? formatDate(effectsCheckedUntil) : from
    return until === from
      ? `Checked against legislation.gov.uk on ${from}`
      : `Checked against legislation.gov.uk between ${from} and ${until}`
  }
  return acquiredAt
    ? `Retrieved from legislation.gov.uk on ${formatDate(acquiredAt)}; not yet checked for later changes`
    : 'Not yet checked against legislation.gov.uk'
}
