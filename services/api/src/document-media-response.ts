const DOCUMENT_MEDIA_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'none'; sandbox"

export function createDocumentMediaResponse(
  bytes: Uint8Array,
  contentType: string,
): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': 'attachment',
      'content-security-policy': DOCUMENT_MEDIA_CONTENT_SECURITY_POLICY,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
