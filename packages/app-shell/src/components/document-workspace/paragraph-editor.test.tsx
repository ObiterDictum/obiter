// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealTypingLine } from './paragraph-editor'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function rect(top: number, height: number, width = 200): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    toJSON: () => ({}),
  }
}

function mockBox(node: Element, top: number, height: number) {
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(rect(top, height))
}

describe('revealTypingLine', () => {
  it('scrolls the typing line into the desk when it is below the viewport', () => {
    const desk = document.createElement('div')
    desk.setAttribute('data-document-desk', '')
    Object.defineProperty(desk, 'scrollTop', { value: 0, writable: true })
    const node = document.createElement('textarea')
    desk.append(node)
    document.body.append(desk)
    mockBox(desk, 0, 400)
    mockBox(node, 500, 20)
    revealTypingLine(node)
    expect(desk.scrollTop).toBe(128)
  })

  it('does not scroll the page body when the caret is below the footer', () => {
    const desk = document.createElement('div')
    desk.setAttribute('data-document-desk', '')
    Object.defineProperty(desk, 'scrollTop', { value: 0, writable: true })
    const page = document.createElement('div')
    page.setAttribute('data-document-page', '')
    Object.defineProperty(page, 'scrollTop', { value: 40, writable: true })
    const body = document.createElement('div')
    body.setAttribute('aria-label', 'Document body')
    Object.defineProperty(body, 'scrollTop', { value: 24, writable: true })
    const node = document.createElement('textarea')
    body.append(node)
    page.append(body)
    desk.append(page)
    document.body.append(desk)
    mockBox(desk, 0, 400)
    mockBox(node, 100, 20)
    revealTypingLine(node)
    expect(page.scrollTop).toBe(0)
    expect(body.scrollTop).toBe(0)
  })
})
