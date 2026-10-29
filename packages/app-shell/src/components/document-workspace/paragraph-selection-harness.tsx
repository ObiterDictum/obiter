import { fireEvent, screen } from '@testing-library/react'

export function clickParagraph(paragraphId: string, offset = 0) {
  const root = document.querySelector(`[data-paragraph-id="${paragraphId}"]`)
  if (!(root instanceof HTMLElement)) {
    throw new Error(`no paragraph ${paragraphId} rendered`)
  }
  const textRoot = root.querySelector('[data-paragraph-text]')
  if (!(textRoot instanceof HTMLElement)) {
    throw new Error(`no text root in ${paragraphId}`)
  }
  const node = firstText(textRoot)
  // SAFETY: caretPositionFromPoint is a browser API absent from lib.dom; it is only read here (never called) and restored after the stubbed click below.
  const point = (
    document as Document & {
      caretPositionFromPoint?: unknown
    }
  ).caretPositionFromPoint
  Object.assign(document, {
    caretPositionFromPoint: () => ({ offsetNode: node, offset }),
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

export function placeCaret(offset: number) {
  const field = bodyField()
  field.setSelectionRange(offset, offset)
  return field
}

export function nativeSelect(from: number, to: number) {
  const field = bodyField()
  field.focus()
  field.setSelectionRange(from, to)
  fireEvent.select(field)
  fireEvent.mouseUp(field)
  return field
}

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
