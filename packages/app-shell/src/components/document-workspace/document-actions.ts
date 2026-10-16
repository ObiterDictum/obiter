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
 * Focused elements that consume typed text honestly: keystrokes keep landing
 * in them while a flight runs, so focus may stay. Everything else (a button
 * the flight disables or unmounts, a ribbon control, the document body)
 * swallows the burst, so focus is handed to the caret's field instead. The
 * gate keys on the element's shape rather than a marker on each save control,
 * because a marker is forgotten by the next caller and this class of defect
 * has already recurred. An open modal is left alone: moving focus out of a
 * dialog the flight did not open is worse than losing the burst.
 */
const TYPED_TEXT_FIELD =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]'

/**
 * Focus the caret's field: the textarea the selected paragraph mounts,
 * marked across the body, a pending insert and an open margin story by
 * `[aria-current]` on its `[data-paragraph-id]` host.
 */
export function refocusCaret(): void {
  if (typeof document === 'undefined') return
  document
    .querySelector<HTMLElement>(
      '[data-paragraph-id][aria-current="true"] textarea',
    )
    ?.focus({ preventScroll: true })
}

/**
 * Call before starting async work that can disable or unmount the focused
 * control: a save, a tracked-change decision, a comment mutation. If the
 * control holds DOM focus when the flight begins (Enter or Space on the
 * button), the browser drops focus to `document.body` and every keystroke
 * typed until the remount is silently lost, so the focus is handed to the
 * caret's field first. The pointer path never needed this: the controls'
 * wrappers preventDefault mousedown, keeping focus in the editor.
 */
export function refocusCaretBeforeFlight(): void {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (!(active instanceof Element)) return
  if (active.closest('[role="dialog"]') !== null) return
  if (active.closest(TYPED_TEXT_FIELD) !== null) return
  refocusCaret()
}

/**
 * Wrap a control's step so ribbon and keyboard share the refocus contract:
 * undo, redo, print and reload can each disable or unmount the focused
 * control mid-step — an emptied stack disables the button, a cleared banner
 * unmounts it — so focus is handed to the caret before the step can drop it
 * to document.body and lose the typed burst.
 */
export function withCaretRefocus(step: () => void): () => void {
  return () => {
    refocusCaretBeforeFlight()
    step()
  }
}

/**
 * Navigation-pane arrival: after `selectParagraph` has mounted the target's
 * editor (one frame later), scroll its block into the desk's viewport and
 * hand DOM focus to its field, so a keyboard or pointer choice lands a real
 * caret rather than just marking state.
 */
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
