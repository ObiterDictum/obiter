/**
 * Bounded reading of an outbound upstream response body.
 *
 * Upstream bodies are untrusted too, so the read stops at a byte cap and the
 * reader is cancelled as soon as the cap is crossed. The deadline passed to
 * `fetch` still aborts the stream, so a stalled body cannot hold the request
 * open past it.
 *
 * This lives outside `routes/` so the request-body architecture boundary keeps
 * proving that route modules never read a raw body stream directly; this
 * module is the reviewed, bounded exception for outbound responses. It is
 * distinct from `limited-request-body.ts`, which bounds incoming requests.
 */
export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    return null
  }
  if (response.body === null) return null

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } catch {
    // An aborted body (deadline) or socket error makes the body unusable.
    return null
  }
  return text
}
