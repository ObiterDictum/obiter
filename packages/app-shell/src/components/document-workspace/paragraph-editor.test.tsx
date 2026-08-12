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
})
