export interface WithdrawalCandidate {
  firstSeenAt: string
  runId: string
  checkedUris: string[]
}

export interface WithdrawnInfo {
  at: string
  checkedUris: string[]
  runIds: string[]
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry): entry is string => typeof entry === 'string')
  )
}

export function readWithdrawalCandidate(
  providerJson: unknown,
): WithdrawalCandidate | null {
  if (typeof providerJson !== 'object' || providerJson === null) return null
  const raw =
    'withdrawalCandidate' in providerJson
      ? providerJson.withdrawalCandidate
      : undefined
  if (typeof raw !== 'object' || raw === null) return null
  // SAFETY: raw passed the non-null object check above; each field is type-checked immediately below, so the record view only enables reads.
  const { firstSeenAt, runId, checkedUris } = raw as Record<string, unknown>
  if (
    typeof firstSeenAt !== 'string' ||
    typeof runId !== 'string' ||
    !isStringArray(checkedUris)
  ) {
    return null
  }
  return { firstSeenAt, runId, checkedUris }
}

export function readWithdrawnInfo(providerJson: unknown): WithdrawnInfo | null {
  if (typeof providerJson !== 'object' || providerJson === null) return null
  const raw = 'withdrawn' in providerJson ? providerJson.withdrawn : undefined
  if (typeof raw !== 'object' || raw === null) return null
  // SAFETY: raw passed the non-null object check above; each field is type-checked immediately below, so the record view only enables reads.
  const { at, checkedUris, runIds } = raw as Record<string, unknown>
  if (
    typeof at !== 'string' ||
    !isStringArray(checkedUris) ||
    !isStringArray(runIds)
  ) {
    return null
  }
  return { at, checkedUris, runIds }
}
