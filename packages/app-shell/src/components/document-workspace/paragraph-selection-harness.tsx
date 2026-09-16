import { fireEvent, screen } from '@testing-library/react'

/**
 * Test seams for the document selection suites. Clicking into a paragraph is
 * how the product focuses one; jsdom has no hit testing, so the point lookup
 * the click path uses is stubbed the same way the caret suites stub it.
 */
export function clickParagraph(paragraphId: string) {
  const root = document.querySelector(`[data-paragraph-id="${paragraphId}"]`)
  if (!(root instanceof HTMLElement)) {
    throw new Error(`no paragraph ${paragraphId} rendered`)
  }
  const textRoot = root.querySelector('[data-paragraph-text]')
  if (!(textRoot instanceof HTMLElement)) {
    throw new Error(`no text root in ${paragraphId}`)
  }
  const node = firstText(textRoot)
  const point = (
    document as Document & {
      caretPositionFromPoint?: unknown
    }
  ).caretPositionFromPoint
  Object.assign(document, {
    caretPositionFromPoint: () => ({ offsetNode: node, offset: 0 }),
  })
  const page = textRoot.closest('[data-document-page]') ?? root
  fireEvent.mouseDown(page, { clientX: 1, clientY: 1 })
  fireEvent.click(node.parentElement ?? root, { clientX: 1, clientY: 1 })
  Object.assign(document, { caretPositionFromPoint: point })
}

function firstText(root: HTMLElement): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const node = walker.nextNode()
  if (!(node instanceof Text)) throw new Error('no text node')
  return node
}

/** The rendered visual rows of a paragraph, in the projection the caret uses. */
export function renderedLines(paragraphId: string): Array<{
  from: number
  to: number
}> {
  const root = document.querySelector(`[data-paragraph-id="${paragraphId}"]`)
  if (!root) return []
  return [...root.querySelectorAll('[data-line-from]')].map((node) => ({
    from: Number(node.getAttribute('data-line-from') ?? '0'),
    to: Number(node.getAttribute('data-line-to') ?? '0'),
  }))
}

export function bodyField(): HTMLTextAreaElement {
  const node = screen.getByLabelText('Paragraph text')
  if (!(node instanceof HTMLTextAreaElement)) {
    throw new Error('expected a paragraph editor')
  }
  return node
}

/** Puts the caret at a model offset without a click, the way a test needs it. */
export function placeCaret(offset: number) {
  const field = bodyField()
  field.setSelectionRange(offset, offset)
  return field
}

/**
 * Selects a range inside the focused paragraph the way a mouse drag would.
 * React only synthesises onSelect from its own dependency events, so the
 * mouseup a drag ends with is part of the simulation.
 */
export function nativeSelect(from: number, to: number) {
  const field = bodyField()
  field.focus()
  field.setSelectionRange(from, to)
  fireEvent.select(field)
  fireEvent.mouseUp(field)
  return field
}

/**
 * The text painted as selected in one paragraph. A paragraph split across page
 * blocks is rendered more than once, so every block's marks are joined in
 * document order.
 */
export function selectedText(paragraphId: string): string {
  return [...document.querySelectorAll(`[data-paragraph-id="${paragraphId}"]`)]
    .flatMap((root) => [...root.querySelectorAll('[data-selected-text]')])
    .map((node) => node.textContent ?? '')
    .join('')
}

export function selectedMarkCount(): number {
  return document.querySelectorAll('[data-selected-text]').length
}

export function selectionStatus(): string {
  return (
    document.querySelector('[data-selection-status]')?.textContent?.trim() ?? ''
  )
}
