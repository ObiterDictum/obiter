const UPLOAD_PATH = /^\/api\/matters\/([^/]+)\/documents$/

export const PROBE_PATH = '/api/matters'

export function createHttpTransport({
  apiOrigin,
  token,
  matterId,
  fetchImpl = fetch,
  FormDataImpl = FormData,
  FileImpl = File,
  fixtureFilename,
  contentType,
}) {
  const uploadUrl = `${apiOrigin}/api/matters/${matterId}/documents`
  if (!UPLOAD_PATH.test(new URL(uploadUrl).pathname))
    throw new Error(`Upload URL ${uploadUrl} is not a document upload path.`)

  return {
    async upload(fixture, { signal }) {
      const form = new FormDataImpl()
      form.set(
        'file',
        new FileImpl([fixture.content], fixtureFilename(fixture), {
          type: contentType,
        }),
      )
      const response = await fetchImpl(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal,
      })
      return {
        outcome: 'response',
        status: response.status,
        body: await response.json().catch(() => null),
      }
    },
    async probe({ signal }) {
      const response = await fetchImpl(`${apiOrigin}${PROBE_PATH}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      })
      return { outcome: 'response', status: response.status }
    },
  }
}
