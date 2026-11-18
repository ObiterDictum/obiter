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

export function scheduleFilename(extension: '.pdf' | '.docx') {
  return `redaction-schedule${extension}`
}
