/**
 * How long a download's object URL is kept alive after the click. Revoking on
 * the next macrotask races a browser that defers the blob fetch (WebKit in
 * particular), which then fails the download. A minute is far past any realistic
 * scheduling delay and still releases the URL promptly.
 */
const DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Defer revoke past the click handler so the browser can start the download.
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

/**
 * The schedule's download name. It never carries the source filename, which can
 * itself name somebody the copy redacts; the server sends the same name.
 */
export function scheduleFilename(extension: '.pdf' | '.docx') {
  return `redaction-schedule${extension}`
}
