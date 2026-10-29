import '@obiter/test-dom'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentEditOperation } from '@obiter/contracts'
import { openRibbonTab } from './editor-test-commands'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  command,
} from './docx-workspace-harness'

import { fontColourSelectValue } from './editor-formatting-panel'
import { clickParagraph, nativeSelect } from './paragraph-selection-harness'

const DECORATED_XML =
  '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:i/><w:u w:val="single"/><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="FF0000"/><w:smallCaps/></w:rPr>'

const AUTO_COLOUR_XML = '<w:rPr><w:color w:val="auto"/></w:rPr>'

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

function fontSelect(name: string): HTMLElement {
  const node = screen.getByRole('combobox', { name })
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
  fireEvent.click(command('Save'))
  return waitFor(() => expect(editAsync).toHaveBeenCalled())
}

describe('the font formatting controls', () => {
  it('reads the stored font values back on a fresh model', () => {
    mountWorkspace({ models: { doc_1: decoratedModel() } })
    clickParagraph('p1')
    nativeSelect(0, 5)
    openRibbonTab('Home')

    expect(fontSelect('Font').textContent).toBe('Georgia')
    expect(fontSelect('Font size').textContent).toBe('14')
    expect(fontSelect('Font colour').textContent).toBe('Red')
    expect(spanOf('p1', 'Hello')?.style.fontFamily ?? '').toContain('Georgia')
    expect(spanOf('p1', 'Hello')?.style.fontSize ?? '').toContain('px')
  })

  it('paints an explicit auto colour as Automatic, not a blank control', () => {
    const auto = multiParagraphModel([
      {
        id: 'p1',
        runs: [
          {
            id: 'p1-r',
            text: 'Hello',
            preservedXmlFragments: [AUTO_COLOUR_XML],
          },
        ],
        preservedXmlFragments: [],
      },
      paragraph('p2', 'tail'),
    ])
    mountWorkspace({ models: { doc_1: auto } })
    clickParagraph('p1')
    nativeSelect(0, 5)
    openRibbonTab('Home')

    expect(fontColourSelectValue('auto')).toBe('')
    expect(fontColourSelectValue('FF0000')).toBe('FF0000')
    expect(fontColourSelectValue(null)).toBe('')
    expect(fontSelect('Font colour').textContent).toBe('Automatic')
  })

  it('clears every direct character property through one save operation', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: decoratedModel() }, editAsync })
    clickParagraph('p1')
    nativeSelect(0, 5)
    openRibbonTab('Home')

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

  it('reverts and reapplies a character change with undo and redo', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    clickParagraph('p1')
    nativeSelect(0, 5)

    fireEvent.click(control('Bold'))
    expect(spanOf('p1', 'Hello')?.style.fontWeight).toBe('700')

    fireEvent.click(control('Undo'))
    expect(spanOf('p1', 'Hello')?.style.fontWeight ?? '').not.toBe('700')

    fireEvent.click(control('Redo'))
    expect(spanOf('p1', 'Hello')?.style.fontWeight).toBe('700')

    // Applying a font value is the same draft-history path; the e2e journey
    // covers the value itself through the Base UI select.
  })

  it('queues the font controls and clear formatting under track changes', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    fireEvent.click(screen.getByRole('switch', { name: 'Track changes' }))
    openRibbonTab('Home')
    clickParagraph('p1')
    nativeSelect(1, 4)

    for (const name of ['Font', 'Font size', 'Font colour']) {
      expect(fontSelect(name)).toHaveProperty('disabled', false)
    }
    expect(fontSelect('Font')).toBeTruthy()
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
