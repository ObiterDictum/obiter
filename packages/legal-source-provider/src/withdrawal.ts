/**
 * Withdrawal state stored in `legal_source_documents.provider_json`.
 *
 * Postgres is the record and Meilisearch is derived, so a judgment withdrawn
 * upstream is marked here, never deleted. `withdrawn` present means withdrawn;
 * every reader uses `provider_json->>'withdrawn' is null` for "not withdrawn".
 * `withdrawalCandidate` is the first of the two required observations (a
 * definitive 404 on the document's own URIs, confirmed on a later run at
 * least 24h apart). Camel case matches the provider metadata sharing the
 * column. One definition here because the checker writes it and the API
 * reads it — a second one drifts and the two disagree about what withdrawn
 * means.
 */

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
  // Malformed candidate state restarts the two-run clock rather than
  // confirming: the safe direction is to wait for fresh evidence, and the
  // audit rows still record what was observed.
  if (typeof providerJson !== 'object' || providerJson === null) return null
  const raw = (providerJson as { withdrawalCandidate?: unknown })
    .withdrawalCandidate
  if (typeof raw !== 'object' || raw === null) return null
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
  const raw = (providerJson as { withdrawn?: unknown }).withdrawn
  if (typeof raw !== 'object' || raw === null) return null
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
