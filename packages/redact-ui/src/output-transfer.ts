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

export async function shareOrDownload(blob: Blob, filename: string) {
  const file = new File([blob], filename, {
    type: blob.type || 'application/octet-stream',
  })
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename })
      return
    }
  } catch {
    // User cancelled share or share failed — fall through to download.
  }
  downloadBlob(blob, filename)
}

export function scheduleFilename(extension: '.pdf' | '.docx') {
  return `redaction-schedule${extension}`
}
