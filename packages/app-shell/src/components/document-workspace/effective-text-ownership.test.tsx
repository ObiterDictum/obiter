import '@obiter/test-dom'
/*
 * A text draft and a pending range emphasis must describe one string.
 * Range emphasis used to slice the stored run and leave the original run id
 * on the first slice only, so the whole draft was painted onto that slice
 * and the stored tail was appended: `Hello!` became `Hello!llo`.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentEditOperation } from '@obiter/contracts'
import { formattedModel } from '../../document-format-edits'
import {
  effectiveParagraph,
  paragraphPlainText,
} from '../../document-model-text'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  rerenderWorkspace,
} from './docx-workspace-harness'
import { nativeSelect, placeCaret } from './paragraph-selection-harness'

function field(): HTMLTextAreaElement {
  const editor = screen.getByLabelText('Paragraph text')
  if (!(editor instanceof HTMLTextAreaElement)) {
    throw new Error('Paragraph field is missing.')
  }
  return editor
}

function paintedText(paragraphId: string): string {
  const root = document.querySelector(
    `[data-paragraph-id="${paragraphId}"] [data-paragraph-text]`,
  )
  if (!(root instanceof HTMLElement)) {
    throw new Error(`missing painted text for ${paragraphId}`)
  }
  const overlay = root.querySelector('[data-caret-run-overlay]')
  const source = overlay instanceof HTMLElement ? overlay : root
  return (source.textContent ?? '').replaceAll('\u00a0', '')
}

function runParts(paragraphId: string): string[] {
  const overlay = document.querySelector(
    `[data-paragraph-id="${paragraphId}"] [data-caret-run-overlay]`,
  )
  const root =
    overlay instanceof HTMLElement
      ? overlay
      : document.querySelector(
          `[data-paragraph-id="${paragraphId}"] [data-paragraph-text]`,
        )
  if (!(root instanceof HTMLElement)) return []
  return [...root.querySelectorAll('span.relative')].flatMap((span) => {
    const text = (span.textContent ?? '').replaceAll('\u00a0', '')
    return text.length > 0 ? [text] : []
  })
}

function hasUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

function saveOperations(editAsync: ReturnType<typeof vi.fn>) {
  const call = editAsync.mock.calls[0]?.[0] as
    { operations?: DocumentEditOperation[] } | undefined
  return call?.operations ?? []
}

function helloModel() {
  return multiParagraphModel([
    paragraph('p1', 'Hello'),
    paragraph('p2', 'tail'),
  ])
}

function focusHello() {
  fireEvent.click(screen.getByText('Hello'))
}

function typeHelloBang() {
  focusHello()
  fireEvent.change(field(), { target: { value: 'Hello!' } })
}

function boldFirstTwo() {
  nativeSelect(0, 2)
  fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
}

function collapseSelection() {
  fireEvent.keyDown(field(), { key: 'Escape' })
}

describe('text draft and range emphasis share one string', () => {
  it('does not paint a whole draft onto the first formatted slice', () => {
    const model = helloModel()
    const format = {
      emphasis: [{ paragraphId: 'p1', from: 0, to: 2, bold: true }],
      paragraphStyles: {},
      numbering: {},
    }
    const painted = formattedModel(model, format).stories[0]?.paragraphs[0]
    if (!painted) throw new Error('painted paragraph missing')
    const effective = effectiveParagraph(painted, { 'p1-r': 'Hello!' })
    // The rejected reading applies `Hello!` to the slice that kept `p1-r`
    // and then appends the stored tail `llo`.
    expect(paragraphPlainText(effective)).toBe('Hello!')
    expect(paragraphPlainText(effective)).not.toBe('Hello!llo')
  })

  it('keeps paint, caret, click and save on Hello! after typing then partial bold', () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    typeHelloBang()
    boldFirstTwo()

    expect(field().value).toBe('Hello!')
    expect(paintedText('p1')).toBe('Hello!')
    expect(paintedText('p1')).not.toBe('Hello!llo')
    const parts = runParts('p1')
    expect(parts.join('')).toBe('Hello!')
    expect(parts.includes('Hello!') && parts.join('').length > 6).toBe(false)
    expect(parts[0]).toBe('He')
    const bold = document.querySelector(
      '[data-paragraph-id="p1"] [data-caret-run-overlay] span',
    )
    if (!(bold instanceof HTMLElement))
      throw new Error('expected a painted run')
    expect(bold.style.fontWeight).toBe('700')

    collapseSelection()
    placeCaret(0)
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(field().value).toBe('tail')
    field().setSelectionRange(0, 0)
    fireEvent.keyDown(field(), { key: 'ArrowLeft' })
    expect(field().value).toBe('Hello!')
    expect(field().selectionStart).toBe(6)

    clickPaintedEnd('p1')
    expect(field().value).toBe('Hello!')
    expect(field().selectionStart).toBe(6)

    fireEvent.change(field(), { target: { value: 'Hello!X' } })
    expect(field().value).toBe('Hello!X')
    expect(paintedText('p1')).toBe('Hello!X')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(field().value).toBe('Hello!')
    expect(paintedText('p1')).toBe('Hello!')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const operations = saveOperations(editAsync)
    const text = operations.find((item) => item.type === 'replace_run_text')
    const emphasis = operations.find((item) => item.type === 'set_run_emphasis')
    expect(text).toMatchObject({ runId: 'p1-r', text: 'Hello!' })
    expect(emphasis).toMatchObject({
      paragraphId: 'p1',
      from: 0,
      to: 2,
      bold: true,
    })
  })

  it('keeps the same string when partial bold comes before the text edit', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    focusHello()
    boldFirstTwo()
    collapseSelection()
    placeCaret(5)
    fireEvent.change(field(), { target: { value: 'Hello!' } })
    expect(field().value).toBe('Hello!')
    expect(paintedText('p1')).toBe('Hello!')
    expect(runParts('p1')[0]).toBe('He')
    placeCaret(0)
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(field().value).toBe('tail')
    field().setSelectionRange(0, 0)
    fireEvent.keyDown(field(), { key: 'ArrowLeft' })
    expect(field().value).toBe('Hello!')
    expect(field().selectionStart).toBe(6)
  })

  it('types at the visible end after partial formatting', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    typeHelloBang()
    boldFirstTwo()
    collapseSelection()
    placeCaret(field().value.length)
    expect(field().selectionStart).toBe(6)
    fireEvent.change(field(), { target: { value: `${field().value}X` } })
    expect(field().value).toBe('Hello!X')
    expect(paintedText('p1')).toBe('Hello!X')
    expect(paintedText('p1').endsWith('X')).toBe(true)
  })

  it('does not apply one draft once per formatted slice', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    typeHelloBang()
    boldFirstTwo()
    collapseSelection()
    nativeSelect(4, 6)
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }))
    expect(paintedText('p1')).toBe('Hello!')
    const parts = runParts('p1')
    expect(parts.join('')).toBe('Hello!')
    expect(parts.join('').length).toBe(6)
    const styled = [
      ...document.querySelectorAll(
        '[data-paragraph-id="p1"] [data-caret-run-overlay] span',
      ),
    ].filter((node): node is HTMLElement => node instanceof HTMLElement)
    expect(styled.some((node) => node.style.fontWeight === '700')).toBe(true)
    expect(styled.some((node) => node.style.fontStyle === 'italic')).toBe(true)
  })

  it('keeps an astral character whole beside a formatting boundary', () => {
    const emoji = 'Hi\u{1f600}'
    mountWorkspace({
      models: {
        doc_1: multiParagraphModel([
          paragraph('p1', emoji),
          paragraph('p2', 'tail'),
        ]),
      },
    })
    fireEvent.click(screen.getByText(emoji))
    fireEvent.change(field(), { target: { value: `${emoji}!` } })
    nativeSelect(0, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    const visible = `${emoji}!`
    expect(field().value).toBe(visible)
    expect(paintedText('p1')).toBe(visible)
    expect(hasUnpairedSurrogate(paintedText('p1'))).toBe(false)
    for (const part of runParts('p1')) {
      expect(hasUnpairedSurrogate(part)).toBe(false)
    }
    collapseSelection()
    placeCaret(0)
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(field().value).toBe('tail')
    field().setSelectionRange(0, 0)
    fireEvent.keyDown(field(), { key: 'ArrowLeft' })
    expect(field().value).toBe(visible)
    expect(field().selectionStart).toBe(visible.length)
  })

  it('undoes text and formatting independently without splitting the string', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    typeHelloBang()
    boldFirstTwo()
    expect(paintedText('p1')).toBe('Hello!')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(field().value).toBe('Hello!')
    expect(paintedText('p1')).toBe('Hello!')
    const bold = document.querySelector(
      '[data-paragraph-id="p1"] [data-caret-run-overlay] span',
    )
    if (!(bold instanceof HTMLElement))
      throw new Error('expected a painted run')
    expect(bold.style.fontWeight).not.toBe('700')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(field().value).toBe('Hello')
    expect(paintedText('p1')).toBe('Hello')
  })

  it('reloads the saved string from stored slices', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    const saved = multiParagraphModel([
      {
        id: 'p1',
        runs: [
          {
            id: 'p1-a',
            text: 'He',
            preservedXmlFragments: ['<w:rPr><w:b/></w:rPr>'],
          },
          { id: 'p1-b', text: 'llo!', preservedXmlFragments: [] },
        ],
        preservedXmlFragments: [],
      },
      paragraph('p2', 'tail'),
    ])
    const view = mountWorkspace({
      models: { doc_1: helloModel(), doc_2: saved },
      editAsync,
    })
    typeHelloBang()
    boldFirstTwo()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(editAsync).toHaveBeenCalled())
    const text = saveOperations(editAsync).find(
      (item) => item.type === 'replace_run_text',
    )
    expect(text).toMatchObject({ text: 'Hello!' })

    rerenderWorkspace(view, 'doc_2')
    expect(paintedText('p1')).toBe('Hello!')
    fireEvent.click(screen.getByText('He'))
    expect(field().value).toBe('Hello!')
    placeCaret(0)
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(field().value).toBe('tail')
    field().setSelectionRange(0, 0)
    fireEvent.keyDown(field(), { key: 'ArrowLeft' })
    expect(field().value).toBe('Hello!')
    expect(field().selectionStart).toBe(6)
    fireEvent.change(field(), { target: { value: 'Hello!X' } })
    expect(field().value).toBe('Hello!X')
    expect(paintedText('p1')).toBe('Hello!X')
  })
})

function clickPaintedEnd(paragraphId: string) {
  const paragraphEl = document.querySelector(
    `[data-paragraph-id="${paragraphId}"]`,
  )
  if (!(paragraphEl instanceof HTMLElement)) {
    throw new Error(`missing paragraph ${paragraphId}`)
  }
  const textRoot = paragraphEl.querySelector('[data-paragraph-text]')
  if (!(textRoot instanceof HTMLElement)) {
    throw new Error('missing text root')
  }
  const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  let current = walker.nextNode()
  while (current) {
    if (current instanceof Text && (current.textContent ?? '').length > 0) {
      last = current
    }
    current = walker.nextNode()
  }
  if (!last) throw new Error('missing painted text node')
  const original = document.caretPositionFromPoint
  Object.assign(document, {
    caretPositionFromPoint: () => ({ offsetNode: last, offset: last.length }),
  })
  fireEvent.mouseDown(paragraphEl, { clientX: 8, clientY: 8 })
  fireEvent.click(paragraphEl, { clientX: 8, clientY: 8 })
  Object.assign(document, { caretPositionFromPoint: original })
}
