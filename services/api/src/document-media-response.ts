const DOCUMENT_MEDIA_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'none'; sandbox"

/**
 * Download filename as RFC 5987: an ASCII-only `filename=` fallback plus
 * `filename*=UTF-8''` carrying the percent-encoded original. A raw
 * non-ASCII name must never reach Response header construction: U+0080 to
 * U+00FF comes back mangled (latin-1) and anything above U+00FF throws a
 * ByteString TypeError, turning the download into a 500. Pure-ASCII names
 * keep the historic single-parameter form byte for byte.
 */
function documentMediaContentDisposition(safeName: string): string {
  if (/^[\x20-\x7e]*$/.test(safeName)) {
    return `attachment; filename="${safeName}"`
  }
  const fallback = [...safeName]
    .map((ch) => (/^[\x20-\x7e]$/.test(ch) ? ch : '_'))
    .join('')
  let encoded: string | null = null
  try {
    // encodeURIComponent leaves "'()!~*" unescaped; only ! and ~ are
    // RFC 5987 attr-chars, so the rest are percent-encoded as well.
    encoded = encodeURIComponent(safeName).replace(
      /['()*]/g,
      (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
    )
  } catch {
    encoded = null
  }
  if (!encoded) return `attachment; filename="${fallback}"`
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export function createDocumentMediaResponse(
  bytes: Uint8Array,
  contentType: string,
  filename?: string,
): Response {
  const safeName = filename?.replaceAll('"', '')
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': safeName
        ? documentMediaContentDisposition(safeName)
        : 'attachment',
      'content-security-policy': DOCUMENT_MEDIA_CONTENT_SECURITY_POLICY,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
