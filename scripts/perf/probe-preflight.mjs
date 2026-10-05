/*
 * Preflight for the editor-interaction runner.
 *
 * A missing or unusable fixture id used to surface as `/matters/undefined/...`
 * and then as a 180 s selector timeout: three minutes spent proving nothing,
 * with the failure reading like a slow document rather than a broken fixture.
 * The ids the selected modes read are therefore resolved and shape-checked
 * before a browser is launched, and the matter and documents are then confirmed
 * against the API through the session the run signed in with. That is the same
 * authorisation boundary the editor itself goes through — a fixture that the
 * signed-in user cannot read is a refused target, not a fast one.
 */

/** The fixture keys each mode reads. `save` writes to a separate document. */
const MODE_KEYS = {
  typing: ['documentId'],
  scroll: ['documentId'],
  save: ['saveDocumentId'],
}

function requiredId(fixtures, key) {
  const value = fixtures[key]
  const usable =
    typeof value === 'string' &&
    value.trim() !== '' &&
    value !== 'undefined' &&
    value !== 'null' &&
    !/[/\s]/.test(value)
  if (!usable)
    throw new Error(
      `--fixtures "${key}" is missing or is not a usable id ` +
        `(got ${value === undefined ? 'no value' : typeof value}); ` +
        'set it to an id from the lane database',
    )
  return value
}

/**
 * Resolve the ids the selected modes need, naming the missing key before any
 * browser or target work starts. Only the keys the selected modes read are
 * required, so a typo in an unused key cannot block a run.
 */
export function resolveProbeTargets(fixtures, modes) {
  const matterId = requiredId(fixtures, 'matterId')
  const documents = []
  for (const mode of modes) {
    for (const key of MODE_KEYS[mode] ?? []) {
      const id = requiredId(fixtures, key)
      if (!documents.some((document) => document.key === key))
        documents.push({ key, id })
    }
  }
  return { matterId, documents }
}

/**
 * Confirm the fixture matter and documents resolve for the signed-in session.
 * The API answers 404 for both "does not exist" and "not yours", so the message
 * says both rather than guessing which it was.
 */
export async function assertTargetsReachable({
  get,
  apiUrl,
  matterId,
  documents,
}) {
  const checks = [
    { key: 'matterId', path: `/api/matters/${matterId}/documents` },
    ...documents.map(({ key, id }) => ({ key, path: `/api/documents/${id}` })),
  ]
  for (const check of checks) {
    const url = `${apiUrl}${check.path}`
    let response
    try {
      response = await get(url)
    } catch (error) {
      throw new Error(
        `preflight could not reach the API for "${check.key}": ${error.message}`,
      )
    }
    if (response.ok()) continue
    const status = response.status()
    const reason =
      status === 404
        ? 'no such record, or it is not shared with this user'
        : status === 401 || status === 403
          ? 'the signed-in session is not authorised for it'
          : 'the API refused it'
    throw new Error(
      `fixture "${check.key}" is not readable at ${url}: HTTP ${status} (${reason})`,
    )
  }
}
