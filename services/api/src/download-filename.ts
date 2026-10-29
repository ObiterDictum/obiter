export const DOWNLOAD_FILENAME_MAX_LENGTH = 200

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
    if (code < 32 || code === 127 || (code >= 128 && code <= 159)) continue
    next += ch
  }
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

export function downloadContentDisposition(safeName: string) {
  if (/^[\x20-\x7e]*$/.test(safeName)) {
    return `attachment; filename="${safeName}"`
  }
  const fallback = [...safeName]
    .map((ch) => (/^[\x20-\x7e]$/.test(ch) ? ch : '_'))
    .join('')
  let encoded: string | null = null
  try {
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
