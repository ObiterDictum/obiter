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
