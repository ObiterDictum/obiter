const DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, DOWNLOAD_URL_REVOKE_DELAY_MS)
}

export function exportFilename(sourceFilename: string, suffix: string) {
  const cleaned = sourceFilename
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '')
    .trim()
    .replace(/\.(pdf|docx|txt)$/iu, '')
    .trim()
  const encoder = new TextEncoder()
  let stem = ''
  let remaining = 255 - encoder.encode(suffix).length
  for (const character of cleaned) {
    remaining -= encoder.encode(character).length
    if (remaining < 0) break
    stem += character
  }
  return `${stem.trim() || 'Document'}${suffix}`
}
