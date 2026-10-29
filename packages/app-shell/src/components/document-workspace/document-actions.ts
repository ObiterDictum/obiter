export const documentRedactionRunsId = 'document-redaction-runs'

export function revealDocumentRedactionRuns(): void {
  if (typeof document === 'undefined') return
  requestAnimationFrame(() => {
    const region = document.getElementById(documentRedactionRunsId)
    if (!region) return
    if (typeof region.scrollIntoView === 'function') {
      region.scrollIntoView({ block: 'center' })
    }
    region.focus({ preventScroll: true })
  })
}

const TYPED_TEXT_FIELD =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]'

export function refocusCaret(): void {
  if (typeof document === 'undefined') return
  const field =
    document.querySelector<HTMLElement>(
      '[data-paragraph-id][aria-current="true"] textarea',
    ) ?? document.querySelector<HTMLElement>('[data-paragraph-id] textarea')
  field?.focus({ preventScroll: true })
}

export function refocusCaretBeforeFlight(): void {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (!(active instanceof Element)) return
  if (active.closest('[role="dialog"]') !== null) return
  if (active.closest(TYPED_TEXT_FIELD) !== null) return
  refocusCaret()
}

export function withCaretRefocus(step: () => void): () => void {
  return () => {
    refocusCaretBeforeFlight()
    step()
  }
}

export function revealParagraph(paragraphId: string): void {
  if (typeof document === 'undefined') return
  requestAnimationFrame(() => {
    const region = document.querySelector<HTMLElement>(
      `[data-paragraph-id="${CSS.escape(paragraphId)}"]`,
    )
    if (region && typeof region.scrollIntoView === 'function') {
      region.scrollIntoView({ block: 'center' })
    }
    refocusCaret()
  })
}
