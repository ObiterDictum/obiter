import '@obiter/test-dom'
/*
 * The Font family, Font size, Font colour and Clear formatting controls must
 * read the same effective text and projected emphasis the editor paints and the
 * save plan sends, and Clear formatting must release every direct property
 * through one set_run_emphasis operation. This is the character-formatting
 * completion slice; Bold/Italic/Underline live in toolbar-emphasis-state.test.tsx
 * and Strike/Highlight/VertAlign in toolbar-character-formatting.test.tsx.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentEditOperation } from '@obiter/contracts'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'
import { clickParagraph, nativeSelect } from './paragraph-selection-harness'

const DECORATED_XML =
  '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:i/><w:u w:val="single"/><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="FF0000"/><w:smallCaps/></w:rPr>'

function helloModel() {
  return multiParagraphModel([
    paragraph('p1', 'Hello'),
    paragraph('p2', 'tail'),
  ])
}

function decoratedModel() {
  return multiParagraphModel([
    {
      id: 'p1',
      runs: [
        { id: 'p1-r', text: 'Hello', preservedXmlFragments: [DECORATED_XML] },
      ],
      preservedXmlFragments: [],
    },
    paragraph('p2', 'tail'),
  ])
}

function fontSelect(name: string): HTMLSelectElement {
  const node = screen.getByLabelText(name)
  if (!(node instanceof HTMLSelectElement)) {
    throw new Error(`missing ${name} select`)
  }
  return node
}

function control(name: string): HTMLButtonElement {
  const button = screen.queryByRole('button', { name })
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing ${name} control`)
  }
  return button
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

function save(editAsync: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  return waitFor(() => expect(editAsync).toHaveBeenCalled())
}

describe('the font formatting controls', () => {
  it('applies font family, size and colour and paints them', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    clickParagraph('p1')
    nativeSelect(0, 5)

    fireEvent.change(fontSelect('Font'), { target: { value: 'Georgia' } })
    fireEvent.change(fontSelect('Font size'), { target: { value: '24' } })
    fireEvent.change(fontSelect('Font colour'), { target: { value: 'FF0000' } })

    const painted = spanOf('p1', 'Hello')
    expect(painted?.style.fontFamily ?? '').toContain('Georgia')
    expect(painted?.style.fontSize).toBe('16px')
    expect(painted?.style.color).toBe('rgb(255, 0, 0)')

    // The selected option reflects the effective direct run property.
    expect(fontSelect('Font').value).toBe('Georgia')
    expect(fontSelect('Font size').value).toBe('24')
    expect(fontSelect('Font colour').value).toBe('FF0000')

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 0,
        to: 5,
        fontFamily: 'Georgia',
        fontSize: 24,
        colour: 'FF0000',
      },
    ])
  })

  it('reads the stored font values back on a fresh model', () => {
    const stored = decoratedModel()
    mountWorkspace({ models: { doc_1: stored } })
    clickParagraph('p1')
    nativeSelect(0, 5)

    expect(fontSelect('Font').value).toBe('Georgia')
    expect(fontSelect('Font size').value).toBe('28')
    expect(fontSelect('Font colour').value).toBe('FF0000')
  })

  it('clears every direct character property through one save operation', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: decoratedModel() }, editAsync })
    clickParagraph('p1')
    nativeSelect(0, 5)

    fireEvent.click(control('Clear formatting'))

    const painted = spanOf('p1', 'Hello')
    expect(painted?.style.fontWeight ?? '').not.toBe('700')
    expect(painted?.style.fontStyle ?? '').not.toBe('italic')
    expect(painted?.style.textDecoration ?? '').toBe('')
    expect(painted?.style.backgroundColor ?? '').toBe('')
    expect(painted?.style.verticalAlign ?? '').toBe('')
    expect(painted?.style.color ?? '').toBe('')
    expect(painted?.style.fontFamily ?? '').not.toContain('Georgia')

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 0,
        to: 5,
        bold: null,
        italic: null,
        underline: null,
        strikethrough: null,
        fontFamily: null,
        fontSize: null,
        colour: null,
        highlight: null,
        vertAlign: null,
        smallCaps: null,
      },
    ])
  })

  it('reverts and reapplies a font change with undo and redo', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    clickParagraph('p1')
    nativeSelect(0, 5)

    fireEvent.change(fontSelect('Font'), { target: { value: 'Georgia' } })
    expect(spanOf('p1', 'Hello')?.style.fontFamily ?? '').toContain('Georgia')

    fireEvent.click(control('Undo'))
    expect(spanOf('p1', 'Hello')?.style.fontFamily ?? '').not.toContain(
      'Georgia',
    )

    fireEvent.click(control('Redo'))
    expect(spanOf('p1', 'Hello')?.style.fontFamily ?? '').toContain('Georgia')
  })

  it('queues the font controls and clear formatting under track changes', async () => {
    // A mid-run selection is recorded as w:rPrChange, so every character
    // control stays live with tracking on and queues its range operation.
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Track changes off' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }))
    clickParagraph('p1')
    nativeSelect(1, 4)

    for (const name of ['Font', 'Font size', 'Font colour']) {
      expect(fontSelect(name).disabled).toBe(false)
    }
    fireEvent.change(fontSelect('Font'), { target: { value: 'Georgia' } })
    fireEvent.change(fontSelect('Font size'), { target: { value: '24' } })
    fireEvent.change(fontSelect('Font colour'), { target: { value: 'FF0000' } })
    fireEvent.click(control('Clear formatting'))

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 1,
        to: 4,
        bold: null,
        italic: null,
        underline: null,
        strikethrough: null,
        fontFamily: null,
        fontSize: null,
        colour: null,
        highlight: null,
        vertAlign: null,
        smallCaps: null,
      },
    ])
    const call = editAsync.mock.calls[0]?.[0] as
      { trackChanges?: boolean } | undefined
    expect(call?.trackChanges).toBe(true)
  })
})
