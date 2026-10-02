/**
 * The document-level Redact entry lives in the document detail layout, below
 * the editor. The ribbon's "Redact this document" reveals that real control
 * rather than starting a run of its own, so there is exactly one action owner
 * and no path can create two runs for one click.
 */
export const documentRedactionRunsId = 'document-redaction-runs'

export function revealDocumentRedactionRuns(): void {
  if (typeof document === 'undefined') return
  const region = document.getElementById(documentRedactionRunsId)
  if (!region) return
  // jsdom, the test DOM, has no layout and does not implement scrollIntoView.
  if (typeof region.scrollIntoView === 'function') {
    region.scrollIntoView({ block: 'center' })
  }
  region.focus({ preventScroll: true })
}
