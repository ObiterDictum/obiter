import '@obiter/test-dom'
/*
 * The Strikethrough, Highlight, Superscript and Subscript controls must read
 * the same effective text and projected emphasis the editor paints and the save
 * plan sends. That surface lives in toolbar-emphasis-state.test.tsx for
 * Bold/Italic/Underline; this file is the character-formatting slice so neither
 * file crosses the source line ceiling.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentEditOperation } from '@obiter/contracts'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  rerenderWorkspace,
} from './docx-workspace-harness'
import {
  bodyField,
  clickParagraph,
  nativeSelect,
} from './paragraph-selection-harness'

function helloModel() {
  return multiParagraphModel([
    paragraph('p1', 'Hello'),
    paragraph('p2', 'tail'),
  ])
}

function control(name: string): HTMLButtonElement {
  const button = screen.queryByRole('button', { name })
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing ${name} control`)
  }
  return button
}

function pressed(name: string): string | null {
  return control(name).getAttribute('aria-pressed')
}

function paintedSpans(paragraphId: string): HTMLElement[] {
  const root = document.querySelector(
    `[data-paragraph-id="${paragraphId}"] [data-paragraph-text]`,
  )
  if (!(root instanceof HTMLElement)) {
    throw new Error(`missing painted text for ${paragraphId}`)
  }
  const overlay = root.querySelector('[data-caret-run-overlay]')
  const scope = overlay instanceof HTMLElement ? overlay : root
  return [...scope.querySelectorAll('span.relative')].filter(
    (span): span is HTMLElement => span instanceof HTMLElement,
  )
}

function spanOf(paragraphId: string, text: string): HTMLElement | undefined {
  return paintedSpans(paragraphId).find(
    (span) => (span.textContent ?? '') === text,
  )
}

function emphasisOperations(editAsync: ReturnType<typeof vi.fn>) {
  const call = editAsync.mock.calls[0]?.[0] as
    { operations?: DocumentEditOperation[] } | undefined
  return (call?.operations ?? []).filter(
    (operation) => operation.type === 'set_run_emphasis',
  )
}

function typeHelloBang() {
  clickParagraph('p1')
  fireEvent.change(bodyField(), { target: { value: 'Hello!' } })
}

function save(editAsync: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  return waitFor(() => expect(editAsync).toHaveBeenCalled())
}

describe('the character formatting controls', () => {
  it('toggles strikethrough over an unsaved appended character', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    typeHelloBang()
    nativeSelect(5, 6)

    fireEvent.click(control('Strikethrough'))
    expect(pressed('Strikethrough')).toBe('true')
    expect(spanOf('p1', '!')?.style.textDecoration).toContain('line-through')

    fireEvent.click(control('Strikethrough'))
    expect(pressed('Strikethrough')).toBe('false')
    expect(spanOf('p1', '!')?.style.textDecoration).not.toContain(
      'line-through',
    )

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 5,
        to: 6,
        strikethrough: false,
      },
    ])
  })

  it('paints a default highlight and releases it on a second click', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    typeHelloBang()
    nativeSelect(5, 6)

    fireEvent.click(control('Highlight'))
    expect(pressed('Highlight')).toBe('true')
    expect(spanOf('p1', '!')?.style.backgroundColor).not.toBe('')

    fireEvent.click(control('Highlight'))
    expect(pressed('Highlight')).toBe('false')
    expect(spanOf('p1', '!')?.style.backgroundColor).toBe('')

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 5,
        to: 6,
        highlight: 'none',
      },
    ])
  })

  it('keeps superscript and subscript mutually exclusive', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    typeHelloBang()
    nativeSelect(5, 6)

    fireEvent.click(control('Superscript'))
    expect(pressed('Superscript')).toBe('true')
    expect(pressed('Subscript')).toBe('false')
    expect(spanOf('p1', '!')?.style.verticalAlign).toBe('super')

    fireEvent.click(control('Subscript'))
    expect(pressed('Superscript')).toBe('false')
    expect(pressed('Subscript')).toBe('true')
    expect(spanOf('p1', '!')?.style.verticalAlign).toBe('sub')

    fireEvent.click(control('Subscript'))
    expect(pressed('Subscript')).toBe('false')
    expect(spanOf('p1', '!')?.style.verticalAlign).toBe('')

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 5,
        to: 6,
        vertAlign: 'baseline',
      },
    ])
  })

  it('applies the controls over a stored partial selection only', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    clickParagraph('p1')
    nativeSelect(1, 3)

    fireEvent.click(control('Strikethrough'))
    fireEvent.click(control('Highlight'))
    fireEvent.click(control('Superscript'))

    const selected = spanOf('p1', 'el')
    expect(selected?.style.textDecoration).toContain('line-through')
    expect(selected?.style.backgroundColor).not.toBe('')
    expect(selected?.style.verticalAlign).toBe('super')
    expect(spanOf('p1', 'lo')?.style.textDecoration).not.toContain(
      'line-through',
    )

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 1,
        to: 3,
        strikethrough: true,
        highlight: 'yellow',
        vertAlign: 'superscript',
      },
    ])
  })

  it('reads a collapsed caret inside an unsaved highlighted character', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    typeHelloBang()
    nativeSelect(5, 6)
    fireEvent.click(control('Highlight'))
    fireEvent.click(control('Superscript'))

    fireEvent.keyDown(bodyField(), { key: 'Escape' })
    nativeSelect(5, 5)
    expect(pressed('Highlight')).toBe('true')
    expect(pressed('Superscript')).toBe('true')

    fireEvent.click(control('Highlight'))
    expect(pressed('Highlight')).toBe('false')
    expect(spanOf('p1', '!')?.style.backgroundColor).toBe('')
    expect(pressed('Superscript')).toBe('true')
  })

  it('reports saved strike, highlight and vertical align after a fresh reload', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    const saved = multiParagraphModel([
      {
        id: 'p1',
        runs: [
          { id: 'p1-a', text: 'Hello', preservedXmlFragments: [] },
          {
            id: 'p1-b',
            text: '!',
            preservedXmlFragments: [
              '<w:rPr><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/></w:rPr>',
            ],
          },
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
    nativeSelect(5, 6)
    fireEvent.click(control('Strikethrough'))
    fireEvent.click(control('Highlight'))
    fireEvent.click(control('Superscript'))
    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 5,
        to: 6,
        strikethrough: true,
        highlight: 'yellow',
        vertAlign: 'superscript',
      },
    ])

    rerenderWorkspace(view, 'doc_2')
    fireEvent.click(screen.getByText('Hello'))
    nativeSelect(5, 6)
    expect(pressed('Strikethrough')).toBe('true')
    expect(pressed('Highlight')).toBe('true')
    expect(pressed('Superscript')).toBe('true')
    expect(pressed('Subscript')).toBe('false')
  })

  it('keeps aria-pressed and painted state together for foreign spellings', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    const stored = multiParagraphModel([
      {
        id: 'p1',
        runs: [
          {
            id: 'p1-a',
            text: 'Hello',
            preservedXmlFragments: [
              '<w:rPr><w:strike w:val="false"/><w:highlight w:val="DARKBLUE"/><w:vertAlign w:val="SUPERSCRIPT"/><w:rPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:rPr><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="subscript"/></w:rPr></w:rPrChange></w:rPr>',
            ],
          },
        ],
        preservedXmlFragments: [],
      },
      paragraph('p2', 'tail'),
    ])
    mountWorkspace({ models: { doc_1: stored }, editAsync })
    clickParagraph('p1')
    nativeSelect(0, 5)

    // The current rPr is strike off, dark blue and superscript; the tracked
    // history must not press anything, and the aria state must match paint.
    expect(pressed('Strikethrough')).toBe('false')
    expect(pressed('Highlight')).toBe('true')
    expect(pressed('Superscript')).toBe('true')
    expect(pressed('Subscript')).toBe('false')
    expect(spanOf('p1', 'Hello')?.style.textDecoration ?? '').not.toContain(
      'line-through',
    )
    expect(spanOf('p1', 'Hello')?.style.backgroundColor).not.toBe('')
    expect(spanOf('p1', 'Hello')?.style.verticalAlign).toBe('super')

    // A pressed control releases on the next click, so the direction follows
    // what is painted rather than pressing an already-on state.
    fireEvent.click(control('Highlight'))
    expect(pressed('Highlight')).toBe('false')
    expect(spanOf('p1', 'Hello')?.style.backgroundColor).toBe('')
    fireEvent.click(control('Superscript'))
    expect(pressed('Superscript')).toBe('false')
    expect(spanOf('p1', 'Hello')?.style.verticalAlign).toBe('')

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 0,
        to: 5,
        highlight: 'none',
        vertAlign: 'baseline',
      },
    ])
  })
})
