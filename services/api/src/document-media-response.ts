const DOCUMENT_MEDIA_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'none'; sandbox"

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
        ? `attachment; filename="${safeName}"`
        : 'attachment',
      'content-security-policy': DOCUMENT_MEDIA_CONTENT_SECURITY_POLICY,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
