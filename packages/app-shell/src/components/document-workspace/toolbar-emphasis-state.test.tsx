import '@obiter/test-dom'
/*
 * The Bold, Italic and Underline controls must read the same effective text
 * and projected emphasis the editor paints and the save plan sends.
 *
 * They read the stored paragraph instead. Selecting only an unsaved appended
 * character therefore covered no stored run: the button stayed unpressed while
 * the character painted and saved bold, a second click re-applied the emphasis
 * instead of releasing it, and one Undo could not restore a coherent state.
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

/** The painted run spans of one paragraph, from the projection paint uses. */
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

function weightOf(paragraphId: string, text: string): string | undefined {
  return spanOf(paragraphId, text)?.style.fontWeight
}

function paintedText(paragraphId: string): string {
  return paintedSpans(paragraphId)
    .map((span) => span.textContent ?? '')
    .join('')
}

function saveOperations(editAsync: ReturnType<typeof vi.fn>) {
  const call = editAsync.mock.calls[0]?.[0] as
    { operations?: DocumentEditOperation[] } | undefined
  return call?.operations ?? []
}

function emphasisOperations(editAsync: ReturnType<typeof vi.fn>) {
  return saveOperations(editAsync).filter(
    (operation) => operation.type === 'set_run_emphasis',
  )
}

function typeHelloBang() {
  clickParagraph('p1')
  fireEvent.change(bodyField(), { target: { value: 'Hello!' } })
}

/** A drag's press ends the live selection before the new range mirrors. */
function dragSelect(from: number, to: number) {
  fireEvent.mouseDown(bodyField())
  return nativeSelect(from, to)
}

function save(editAsync: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  return waitFor(() => expect(editAsync).toHaveBeenCalled())
}

describe('toolbar state reads the effective paragraph', () => {
  it('presses Bold over an unsaved appended character and saves that emphasis', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    typeHelloBang()
    nativeSelect(5, 6)

    fireEvent.click(control('Bold'))
    expect(weightOf('p1', '!')).toBe('700')
    expect(pressed('Bold')).toBe('true')

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 5,
        to: 6,
        bold: true,
      },
    ])
    expect(saveOperations(editAsync)).toContainEqual({
      type: 'replace_run_text',
      runId: 'p1-r',
      text: 'Hello!',
    })
  })

  it('releases Bold over the same unsaved selection', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    typeHelloBang()
    nativeSelect(5, 6)

    fireEvent.click(control('Bold'))
    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('false')
    expect(weightOf('p1', '!')).not.toBe('700')

    await save(editAsync)
    // One entry, restated off: the save projection no longer holds bold [5,6).
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 5,
        to: 6,
        bold: false,
      },
    ])
  })

  it('restores the toggled-off formatting with one Undo', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    typeHelloBang()
    nativeSelect(5, 6)

    fireEvent.click(control('Bold'))
    fireEvent.click(control('Bold'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(bodyField().value).toBe('Hello!')
    expect(paintedText('p1')).toBe('Hello!')
    expect(weightOf('p1', '!')).toBe('700')
    expect(pressed('Bold')).toBe('true')

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 5,
        to: 6,
        bold: true,
      },
    ])
  })

  it.each([
    ['Italic', 'italic' as const],
    ['Underline', 'underline' as const],
  ])('toggles %s over an unsaved appended character', async (name, flag) => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    typeHelloBang()
    nativeSelect(5, 6)

    fireEvent.click(control(name))
    expect(pressed(name)).toBe('true')
    const bang = spanOf('p1', '!')
    if (!bang) throw new Error('expected the painted unsaved character')
    if (flag === 'italic') expect(bang.style.fontStyle).toBe('italic')
    else expect(bang.style.textDecoration).toBe('underline')

    fireEvent.click(control(name))
    expect(pressed(name)).toBe('false')
    if (flag === 'italic') expect(bang.style.fontStyle).not.toBe('italic')
    else expect(bang.style.textDecoration).not.toBe('underline')

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 5,
        to: 6,
        [flag]: false,
      },
    ])
  })

  it('keeps the stored-only toggle behaviour unchanged', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    clickParagraph('p1')
    nativeSelect(0, 2)

    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('true')
    expect(weightOf('p1', 'He')).toBe('700')

    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('false')
    expect(weightOf('p1', 'He')).not.toBe('700')
  })

  it('reads a selection spanning stored and unsaved text without clamping', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    typeHelloBang()
    nativeSelect(3, 6)

    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('true')
    expect(paintedText('p1')).toBe('Hello!')
    expect(weightOf('p1', 'lo!')).toBe('700')

    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('false')
    expect(weightOf('p1', 'lo!')).not.toBe('700')
  })

  it('keeps the mixed-selection policy: off while mixed, uniform after one click', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    clickParagraph('p1')
    nativeSelect(0, 2)
    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('true')

    dragSelect(0, 4)
    expect(pressed('Bold')).toBe('false')

    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('true')
    expect(weightOf('p1', 'He')).toBe('700')
    expect(weightOf('p1', 'll')).toBe('700')
    expect(weightOf('p1', 'o')).not.toBe('700')
  })

  it('reports a collapsed caret inside an unsaved formatted character', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    typeHelloBang()
    nativeSelect(5, 6)
    fireEvent.click(control('Bold'))

    fireEvent.keyDown(bodyField(), { key: 'Escape' })
    nativeSelect(5, 5)
    expect(pressed('Bold')).toBe('true')

    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('false')
    expect(weightOf('p1', '!')).not.toBe('700')
  })

  it('does not offer redo for the formatting toggle', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    typeHelloBang()
    nativeSelect(5, 6)
    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('true')
    expect(control('Redo (not available yet)').disabled).toBe(true)
  })

  it('reads the projected state after a text edit follows the formatting', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    clickParagraph('p1')
    nativeSelect(0, 2)
    fireEvent.click(control('Bold'))

    fireEvent.keyDown(bodyField(), { key: 'Escape' })
    nativeSelect(5, 5)
    fireEvent.change(bodyField(), { target: { value: 'Hello!' } })
    expect(paintedText('p1')).toBe('Hello!')

    nativeSelect(0, 2)
    expect(pressed('Bold')).toBe('true')
    expect(weightOf('p1', 'He')).toBe('700')
  })

  it('keeps bold and italic buttons independent over the same unsaved range', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    typeHelloBang()
    nativeSelect(5, 6)

    fireEvent.click(control('Bold'))
    fireEvent.click(control('Italic'))
    expect(pressed('Bold')).toBe('true')
    expect(pressed('Italic')).toBe('true')
    const bang = spanOf('p1', '!')
    if (!bang) throw new Error('expected the painted unsaved character')
    expect(bang.style.fontWeight).toBe('700')
    expect(bang.style.fontStyle).toBe('italic')

    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('false')
    expect(pressed('Italic')).toBe('true')
    expect(bang.style.fontWeight).not.toBe('700')
    expect(bang.style.fontStyle).toBe('italic')
  })

  it('toggles an unsaved astral character selected at a widened range', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    const emoji = 'Hi\u{1f600}'
    mountWorkspace({
      models: {
        doc_1: multiParagraphModel([
          paragraph('p1', 'Hi'),
          paragraph('p2', 'tail'),
        ]),
      },
      editAsync,
    })
    clickParagraph('p1')
    fireEvent.change(bodyField(), { target: { value: emoji } })
    // The selection starts inside the surrogate pair; the stored range is
    // widened to the whole character, and the pressed state reads that range.
    nativeSelect(3, 4)

    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('true')
    expect(weightOf('p1', '\u{1f600}')).toBe('700')

    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 2,
        to: 4,
        bold: true,
      },
    ])
  })

  it('reads no emphasis state inside an inserted paragraph', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    clickParagraph('p1')
    fireEvent.keyDown(bodyField(), { key: 'Enter' })

    const insert = screen.getByLabelText(
      'Pending paragraph text',
    ) as HTMLTextAreaElement
    fireEvent.change(insert, { target: { value: 'New line' } })

    expect(pressed('Bold')).toBe('false')
    fireEvent.click(control('Bold'))
    expect(pressed('Bold')).toBe('false')

    await save(editAsync)
    const operations = saveOperations(editAsync)
    expect(operations).toContainEqual({
      type: 'insert_paragraph_after',
      paragraphId: 'p1',
      runs: [{ text: 'New line' }],
    })
    expect(operations.some((op) => op.type === 'set_run_emphasis')).toBe(false)
  })

  it('reports the saved emphasis after a fresh reload', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    const saved = multiParagraphModel([
      {
        id: 'p1',
        runs: [
          { id: 'p1-a', text: 'Hello', preservedXmlFragments: [] },
          {
            id: 'p1-b',
            text: '!',
            preservedXmlFragments: ['<w:rPr><w:b/></w:rPr>'],
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
    fireEvent.click(control('Bold'))
    await save(editAsync)

    rerenderWorkspace(view, 'doc_2')
    fireEvent.click(screen.getByText('Hello'))
    nativeSelect(5, 6)
    expect(pressed('Bold')).toBe('true')
    expect(weightOf('p1', '!')).toBe('700')
  })

  it('reports no emphasis after toggling it off and reloading', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    const saved = multiParagraphModel([
      paragraph('p1', 'Hello!'),
      paragraph('p2', 'tail'),
    ])
    const view = mountWorkspace({
      models: { doc_1: helloModel(), doc_2: saved },
      editAsync,
    })
    typeHelloBang()
    nativeSelect(5, 6)
    fireEvent.click(control('Bold'))
    fireEvent.click(control('Bold'))
    await save(editAsync)
    expect(emphasisOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 5,
        to: 6,
        bold: false,
      },
    ])

    rerenderWorkspace(view, 'doc_2')
    fireEvent.click(screen.getByText('Hello!'))
    nativeSelect(5, 6)
    expect(pressed('Bold')).toBe('false')
    expect(weightOf('p1', '!')).not.toBe('700')
  })
})
