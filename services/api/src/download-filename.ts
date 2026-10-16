/**
 * One filename policy for every bytes-off-the-server route: raw download,
 * DOCX export (ordinary and share-safe), and redaction output files.
 *
 * Input is user-controlled metadata, so the pipeline is: basename only
 * (path traversal), drop control/format characters that would reorder or
 * hide the name in a file manager (bidi embedding/override/isolate controls
 * — `RLO`-class — and C0/C1/DEL), drop the characters Windows and quoted
 * header values cannot carry, trim, then bound the length.
 *
 * Unicode stays: `Content-Disposition` uses RFC 5987 `filename*=` for the
 * faithful name and an ASCII `filename=` fallback for legacy clients, and a
 * raw non-ASCII value never reaches Response header construction — U+0080 to
 * U+00FF mangles to latin-1 and anything above throws a ByteString TypeError.
 * LRM/RLM/ALM marks are kept: they are inert direction marks real RTL names
 * need, not reordering controls.
 */

export const DOWNLOAD_FILENAME_MAX_LENGTH = 200

// Bidi embedding, override and isolate controls: the class that can render a
// downloaded "docx.exe"-style name. Direction marks (LRM/RLM/ALM) are kept.
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/gu
const RESERVED_CHARS = /[<>:"|?*\\/]/gu

export function safeDownloadFilename(
  raw: string,
  options: { extension?: `.${string}`; fallback?: string } = {},
) {
  const leaf = raw.split(/[\\/]/u).pop() ?? ''
  let next = ''
  for (const ch of leaf
    .replace(BIDI_CONTROLS, '')
    .replace(RESERVED_CHARS, '')) {
    const code = ch.codePointAt(0) ?? 0
    // C0, DEL and the C1 block: zero-width in terminals, breaks HTTP/1 header
    // hygiene, and below C0 is already illegal in Response headers.
    if (code < 32 || code === 127 || (code >= 128 && code <= 159)) continue
    next += ch
  }
  // Windows silently eats trailing dots and spaces; keep the name stable
  // across filesystems.
  let base =
    next.trim().replace(/[.\s]+$/u, '') || (options.fallback ?? 'document')
  const extension = options.extension ?? ''
  if (extension && !base.toLowerCase().endsWith(extension.toLowerCase())) {
    base = `${base}${extension}`
  }
  if (base.length <= DOWNLOAD_FILENAME_MAX_LENGTH) return base
  const budget = DOWNLOAD_FILENAME_MAX_LENGTH - extension.length
  const stem =
    base.slice(0, Math.max(1, budget)).replace(/[.\s]+$/u, '') ||
    (options.fallback ?? 'document')
  return extension ? `${stem}${extension}` : stem
}

/**
 * RFC 5987 disposition: an ASCII-only `filename=` fallback plus
 * `filename*=UTF-8''` carrying the percent-encoded original. Pure-ASCII
 * names keep the historic single-parameter form byte for byte.
 */
export function downloadContentDisposition(safeName: string) {
  if (/^[\x20-\x7e]*$/.test(safeName)) {
    return `attachment; filename="${safeName}"`
  }
  const fallback = [...safeName]
    .map((ch) => (/^[\x20-\x7e]$/.test(ch) ? ch : '_'))
    .join('')
  let encoded: string | null = null
  try {
    // encodeURIComponent leaves "'()!~*" unescaped; only ! and ~ are RFC 5987
    // attr-chars, so the rest are percent-encoded as well.
    encoded = encodeURIComponent(safeName).replace(/['()*]/g, (ch) => {
      const code = ch.charCodeAt(0)
      return `%${code.toString(16).toUpperCase()}`
    })
  } catch {
    encoded = null
  }
  if (!encoded) return `attachment; filename="${fallback}"`
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
