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
