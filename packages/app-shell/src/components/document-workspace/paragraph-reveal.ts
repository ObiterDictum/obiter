/**
 * Scrolls the focused editor's line into view inside the document desk. Split
 * from `paragraph-editor.tsx` so the editor component stays under the source
 * ceiling; the editor re-exports it for existing callers.
 */
export function revealTypingLine(node: HTMLElement) {
  const page = node.closest('[data-document-page]')
  if (page instanceof HTMLElement) {
    page.scrollTop = 0
    for (const slot of page.querySelectorAll('[aria-label="Document body"]')) {
      if (slot instanceof HTMLElement) slot.scrollTop = 0
    }
  }
  const desk = node.closest('[data-document-desk]')
  if (!(desk instanceof HTMLElement)) return
  const deskBox = desk.getBoundingClientRect()
  const box = node.getBoundingClientRect()
  if (box.height <= 0) return
  if (box.top >= deskBox.top && box.bottom <= deskBox.bottom) return
  if (box.top < deskBox.top) {
    desk.scrollTop += box.top - deskBox.top - 8
    return
  }
  desk.scrollTop += box.bottom - deskBox.bottom + 8
}
