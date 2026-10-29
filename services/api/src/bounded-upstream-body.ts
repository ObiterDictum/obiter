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
    return null
  }
  return text
}
