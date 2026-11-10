import { formatDate } from './format'

export type LegislationStatus = 'current' | 'amended_not_held' | 'repealed'

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
    return { tone: 'warning', label: 'Amended wording withheld' }
  return { tone: 'success', label: 'No unapplied amendments' }
}
