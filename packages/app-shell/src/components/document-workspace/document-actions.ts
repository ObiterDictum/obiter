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

/**
 * A save started while the Save control holds DOM focus — Enter or Space on
 * the button, or the workspace save shortcut pressed from it — must hand
 * focus back to the caret's field before the flight starts. `saving`
 * disables the control and the browser drops a disabled focused control to
 * `document.body`, so every keystroke until the remount refocus is silently
 * lost. The pointer path never loses the caret: the control's wrapper
 * preventDefaults mousedown, so focus stays in the editor. The control's
 * wrapper carries `data-save-control` so this can recognise the focused
 * element without matching its label; the caret's field is the textarea the
 * selected paragraph mounts, and `[aria-current]` marks it across the body,
 * a pending insert and an open margin story.
 */
export function refocusCaretBeforeSave(): void {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (!(active instanceof Element)) return
  if (active.closest('[data-save-control]') === null) return
  document
    .querySelector<HTMLElement>(
      '[data-paragraph-id][aria-current="true"] textarea',
    )
    ?.focus({ preventScroll: true })
}
