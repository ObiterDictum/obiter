// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'
import {
  bodyField,
  clickParagraph,
  nativeSelect,
  placeCaret,
  renderedLines,
  selectedMarkCount,
  selectedText,
  selectionStatus,
} from './paragraph-selection-harness'

/*
 * jsdom performs no textarea selection movement of its own, so an arrow that
 * the textarea keeps natively (one that stays inside the paragraph) cannot be
 * driven here. Every test below therefore places the caret at the boundary the
 * native step would have reached, which is exactly the state the editor reads,
 * and `placeCaret` stands in for that native move. The browser journey in the
 * PR covers the native movement itself.
 */

const defaultModel = () =>
  multiParagraphModel([
    paragraph('p1', 'Alpha'),
    paragraph('p2', 'Bravo'),
    paragraph('p3', 'Charlie'),
  ])

function mount(model = defaultModel()) {
  const editAsync = vi.fn()
  mountWorkspace({ models: { doc_1: model }, editAsync })
  return { editAsync }
}

function shiftKey(
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  options: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
) {
  const field = bodyField()
  const notPrevented = fireEvent.keyDown(field, {
    key,
    shiftKey: true,
    ...options,
  })
  return { field, notPrevented }
}

function plainKey(
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Escape',
) {
  const field = bodyField()
  const notPrevented = fireEvent.keyDown(field, { key })
  return { field, notPrevented }
}

describe('extending a selection across a paragraph boundary', () => {
  it('extends right from the end of a paragraph into the next', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    const { notPrevented } = shiftKey('ArrowRight')
    expect(notPrevented).toBe(false)
    // The focus moved to the next paragraph while the anchor stayed behind.
    expect(bodyField().value).toBe('Bravo')
    expect(bodyField().selectionEnd).toBe(0)
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)
  })

  it('extends left from the start of a paragraph into the previous', () => {
    mount()
    clickParagraph('p2')
    placeCaret(0)
    shiftKey('ArrowLeft')
    expect(bodyField().value).toBe('Alpha')
    expect(bodyField().selectionEnd).toBe(5)
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)
  })

  it('paints the selected text in every paragraph it covers', () => {
    mount()
    clickParagraph('p1')
    // A native selection inside p1, then a crossing extension: the anchor is
    // p1 offset 3 and the focus moves out of the paragraph.
    nativeSelect(3, 5)
    shiftKey('ArrowRight')
    expect(selectedText('p1')).toBe('ha')
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)
    // Every later step is model-owned, so the focus walks to the end of the
    // next paragraph and then crosses into the one after it.
    for (let step = 0; step < 5; step += 1) shiftKey('ArrowRight')
    expect(selectedText('p2')).toBe('Bravo')
    expect(selectedText('p3')).toBe('')
    shiftKey('ArrowRight')
    expect(selectedText('p3')).toBe('')
    expect(selectionStatus()).toMatch(/3 paragraphs selected/)
  })

  it('extends backwards through several paragraphs with a stable anchor', () => {
    mount()
    clickParagraph('p3')
    placeCaret(0)
    // One step crosses into the end of Bravo, then every later step is owned
    // by the model, so the whole run can be driven here.
    shiftKey('ArrowLeft')
    expect(bodyField().value).toBe('Bravo')
    for (let step = 0; step < 6; step += 1) shiftKey('ArrowLeft')
    expect(bodyField().value).toBe('Alpha')
    expect(selectionStatus()).toMatch(/3 paragraphs selected/)
    expect(selectedText('p2')).toBe('Bravo')
    // The anchor never moved: p3 is entered only as far as its own start.
    expect(selectedText('p3')).toBe('')

    for (let step = 0; step < 5; step += 1) shiftKey('ArrowLeft')
    // Reading order is unchanged, so p1 is selected from its start to its end.
    expect(bodyField().value).toBe('Alpha')
    expect(selectedText('p1')).toBe('Alpha')
    expect(selectionStatus()).toMatch(/3 paragraphs selected/)
  })

  it('contracts to the anchor and then reverses past it', () => {
    mount()
    clickParagraph('p1')
    nativeSelect(3, 5)
    placeCaret(5)
    shiftKey('ArrowRight')
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)

    // Contracting steps the focus back one position at a time, shrinking the
    // range rather than crossing the anchor.
    shiftKey('ArrowLeft')
    expect(bodyField().value).toBe('Alpha')
    expect(selectedText('p1')).toBe('ha')
    shiftKey('ArrowLeft')
    expect(selectedText('p1')).toBe('h')
    shiftKey('ArrowLeft')
    // The anchor itself is where contraction stops.
    expect(selectionStatus()).toBe('')
    expect(selectedMarkCount()).toBe(0)
    expect(bodyField().selectionStart).toBe(3)
    expect(bodyField().selectionEnd).toBe(3)
  })

  it('keeps an empty paragraph selectable and paints its empty row', () => {
    mount(
      multiParagraphModel([
        paragraph('p1', 'Alpha'),
        paragraph('p2', ''),
        paragraph('p3', 'Charlie'),
      ]),
    )
    clickParagraph('p1')
    placeCaret(5)
    shiftKey('ArrowRight')
    expect(selectedText('p2')).toBe('\u00a0')
    shiftKey('ArrowRight')
    expect(bodyField().value).toBe('Charlie')
    expect(selectionStatus()).toMatch(/3 paragraphs selected/)
    expect(selectedText('p2')).toBe('\u00a0')
  })

  it('selects across a hard break and keeps the newline with its own row', () => {
    mount(
      multiParagraphModel([
        paragraph('p1', 'one\ntwo'),
        paragraph('p2', 'next'),
      ]),
    )
    clickParagraph('p1')
    nativeSelect(3, 6)
    // The newline at offset 3 belongs to the row it terminates, so only the
    // second row's characters are painted.
    expect(selectedText('p1')).toBe('tw')
    expect(selectionStatus()).toBe('1 paragraph selected.')
    // The model holds the focus at the offset after the break, so the next
    // step reaches the end of the text and the one after crosses.
    shiftKey('ArrowRight')
    shiftKey('ArrowRight')
    expect(bodyField().value).toBe('next')
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)
  })
})

describe('selections and the sticky visual column', () => {
  const long = 'lorem ipsum dolor sit amet '.repeat(4).trim()

  it('keeps the retained column when a vertical extension crosses paragraphs', () => {
    mount(
      multiParagraphModel([
        paragraph('p1', long),
        paragraph('p2', 'short'),
        paragraph('p3', long),
      ]),
    )
    clickParagraph('p1')
    const rows = renderedLines('p1')
    const last = rows[rows.length - 1]
    if (!last || rows.length < 2) throw new Error('expected wrapped rows')
    const column = 12
    placeCaret(last.from + column)
    shiftKey('ArrowDown')
    expect(bodyField().value).toBe('short')
    // A short destination clamps the caret but never the retained column.
    expect(bodyField().selectionEnd).toBe('short'.length)
    shiftKey('ArrowDown')
    expect(bodyField().value).toBe(long)
    expect(bodyField().selectionEnd).toBe(column)
  })

  it('extends through a wrapped line and crosses into the next paragraph', () => {
    mount(multiParagraphModel([paragraph('p1', long), paragraph('p2', 'next')]))
    clickParagraph('p1')
    const rows = renderedLines('p1')
    const second = rows[1]
    if (!second) throw new Error('expected wrapped rows')
    // A wrapped line is extended natively inside the paragraph; the model is
    // told through the textarea's own selection event.
    nativeSelect(second.from - 1, second.from + 2)
    expect(selectedText('p1')).toBe(
      long.slice(second.from - 1, second.from + 2),
    )
    placeCaret(long.length)
    shiftKey('ArrowDown')
    expect(bodyField().value).toBe('next')
  })
})

describe('collapsing a document selection', () => {
  it('collapses at the focus end on Escape', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    shiftKey('ArrowRight')
    // Further extensions are model-owned, so the focus lands mid-paragraph.
    for (let step = 0; step < 4; step += 1) shiftKey('ArrowRight')
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)
    const { notPrevented } = plainKey('Escape')
    expect(notPrevented).toBe(false)
    expect(selectionStatus()).toBe('')
    expect(selectedMarkCount()).toBe(0)
    expect(bodyField().value).toBe('Bravo')
    expect(bodyField().selectionStart).toBe(4)
    expect(bodyField().selectionEnd).toBe(4)
  })

  it('collapses a backwards selection at its focus, not its ordered end', () => {
    mount()
    clickParagraph('p2')
    placeCaret(0)
    shiftKey('ArrowLeft')
    expect(bodyField().value).toBe('Alpha')
    plainKey('Escape')
    expect(bodyField().value).toBe('Alpha')
    expect(bodyField().selectionStart).toBe(5)
  })

  it('collapses to the ordered end for ArrowRight and start for ArrowLeft', () => {
    mount()
    clickParagraph('p1')
    nativeSelect(3, 5)
    placeCaret(5)
    shiftKey('ArrowRight')
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)

    plainKey('ArrowRight')
    expect(selectionStatus()).toBe('')
    // The ordered end of the selection is the focus at p2 offset 0.
    expect(bodyField().value).toBe('Bravo')
    expect(bodyField().selectionStart).toBe(0)

    clickParagraph('p1')
    placeCaret(5)
    shiftKey('ArrowRight')
    plainKey('ArrowLeft')
    expect(selectionStatus()).toBe('')
    // The ordered start is the anchor at p1 offset 5.
    expect(bodyField().value).toBe('Alpha')
    expect(bodyField().selectionStart).toBe(5)
  })

  it('moves the caret with a plain arrow after collapsing', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    shiftKey('ArrowRight')
    plainKey('ArrowLeft')
    expect(selectionStatus()).toBe('')
    expect(bodyField().value).toBe('Alpha')
    expect(bodyField().selectionStart).toBe(5)
    // A plain arrow at the paragraph edge still crosses, the way E33 moves a
    // collapsed caret.
    plainKey('ArrowRight')
    expect(bodyField().value).toBe('Bravo')
    expect(bodyField().selectionStart).toBe(0)
  })
})

describe('select all and platform modifiers', () => {
  it('selects the whole body on Ctrl+A', () => {
    mount()
    clickParagraph('p2')
    placeCaret(1)
    const notPrevented = fireEvent.keyDown(bodyField(), {
      key: 'a',
      ctrlKey: true,
    })
    expect(notPrevented).toBe(false)
    expect(selectionStatus()).toMatch(/3 paragraphs selected/)
    expect(selectedText('p1')).toBe('Alpha')
    expect(selectedText('p2')).toBe('Bravo')
    expect(selectedText('p3')).toBe('Charlie')
  })

  it('treats Meta+A as select all as well', () => {
    mount()
    clickParagraph('p1')
    placeCaret(0)
    fireEvent.keyDown(bodyField(), { key: 'a', metaKey: true })
    expect(selectionStatus()).toMatch(/3 paragraphs selected/)
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Meta', { metaKey: true }],
  ])(
    'collapses the selection on %s+Arrow instead of leaving it live',
    (_name, options) => {
      mount()
      clickParagraph('p1')
      placeCaret(5)
      shiftKey('ArrowRight')
      expect(selectionStatus()).toMatch(/2 paragraphs selected/)
      // The first modified arrow collapses the model selection so the native
      // move and the model agree; the shortcut is native after that.
      const { notPrevented } = shiftKey('ArrowRight', options)
      expect(notPrevented).toBe(false)
      expect(selectionStatus()).toBe('')
      expect(document.querySelectorAll('[data-selected-text]')).toHaveLength(0)
    },
  )

  it('collapses the selection on Home and End instead of leaving it live', () => {
    for (const key of ['Home', 'End'] as const) {
      mount()
      clickParagraph('p1')
      placeCaret(5)
      shiftKey('ArrowRight')
      expect(selectionStatus()).toMatch(/2 paragraphs selected/)
      const notPrevented = fireEvent.keyDown(bodyField(), { key })
      expect(notPrevented).toBe(false)
      expect(selectionStatus()).toBe('')
      expect(document.querySelectorAll('[data-selected-text]')).toHaveLength(0)
    }
  })

  it('ignores Shift+Arrow during an IME composition, then resumes', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    const field = bodyField()
    fireEvent.compositionStart(field)
    const notPrevented = fireEvent.keyDown(field, {
      key: 'ArrowRight',
      shiftKey: true,
    })
    expect(notPrevented).toBe(true)
    expect(selectionStatus()).toBe('')
    fireEvent.compositionEnd(field)
    shiftKey('ArrowRight')
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)
  })

  it('ignores an arrow while the keydown itself is composing', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    const notPrevented = fireEvent.keyDown(bodyField(), {
      key: 'ArrowRight',
      shiftKey: true,
      isComposing: true,
    })
    expect(notPrevented).toBe(true)
    expect(selectionStatus()).toBe('')
  })
})

describe('a collapsed selection hands the caret back to native movement', () => {
  // A selection shrunk back onto its anchor must be treated as gone: the caret
  // the user then puts somewhere with a native move is the anchor the next
  // extension uses, not the anchor of the ghost selection.
  const short = () =>
    multiParagraphModel([paragraph('p1', 'ha'), paragraph('p2', 'Bravo')])

  function collapseAtStart() {
    clickParagraph('p1')
    nativeSelect(0, 2)
    shiftKey('ArrowRight')
    shiftKey('ArrowLeft')
    shiftKey('ArrowLeft')
    shiftKey('ArrowLeft')
    expect(selectionStatus()).toBe('')
  }

  it('anchors a later extension at the real caret, not the stale anchor', () => {
    mount(short())
    collapseAtStart()
    // Native movement inside the paragraph; no select event reaches the model.
    placeCaret(2)
    shiftKey('ArrowRight')
    // The anchor is the caret at the paragraph end, so nothing of p1 is
    // covered. Reusing the collapsed anchor would paint 'ha'.
    expect(selectedText('p1')).toBe('')
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)
    // Backspace then joins the two paragraphs, keeping 'ha'.
    fireEvent.keyDown(bodyField(), { key: 'Backspace' })
    expect(bodyField().value).toBe('haBravo')
  })

  it('mirrors a native selection made after the collapse', () => {
    mount(
      multiParagraphModel([paragraph('p1', 'hands'), paragraph('p2', 'Bravo')]),
    )
    collapseAtStart()
    // A mouse drag made after the collapse must be mirrored again, not blocked
    // by the collapsed selection object the model still held.
    nativeSelect(1, 3)
    expect(selectionStatus()).toMatch(/1 paragraph selected/)
    expect(selectedText('p1')).toBe('an')
  })

  it('re-anchors after reversing back through the anchor', () => {
    mount(
      multiParagraphModel([paragraph('p1', 'hands'), paragraph('p2', 'Bravo')]),
    )
    clickParagraph('p1')
    nativeSelect(2, 5)
    shiftKey('ArrowRight')
    expect(selectedText('p1')).toBe('nds')
    // Reverse the extension back through the anchor, one position at a time.
    shiftKey('ArrowLeft')
    shiftKey('ArrowLeft')
    shiftKey('ArrowLeft')
    shiftKey('ArrowLeft')
    expect(selectionStatus()).toBe('')
    // A native move then puts the caret at the paragraph end, and the next
    // crossing must anchor there, not at the collapsed anchor 2 (which would
    // paint 'nds').
    placeCaret(5)
    shiftKey('ArrowRight')
    expect(selectedText('p1')).toBe('')
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)
  })
})

describe('Escape leaves the paragraph', () => {
  it('collapses a live selection first, then blurs on the next press', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    shiftKey('ArrowRight')
    expect(selectionStatus()).toMatch(/2 paragraphs selected/)
    // First Escape collapses rather than leaving the selection and the caret
    // disagreeing.
    plainKey('Escape')
    expect(selectionStatus()).toBe('')
    expect(screen.getByLabelText('Paragraph text')).toBeTruthy()
    // Second Escape leaves the paragraph.
    plainKey('Escape')
    expect(screen.queryByLabelText('Paragraph text')).toBeNull()
  })

  it('keeps an unsaved edit when it leaves the paragraph', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    fireEvent.change(bodyField(), { target: { value: 'Alpha!' } })
    plainKey('Escape')
    expect(screen.queryByLabelText('Paragraph text')).toBeNull()
    // Re-entering the paragraph shows the edit; nothing unsaved was discarded.
    clickParagraph('p1')
    expect(bodyField().value).toBe('Alpha!')
  })
})

describe('selection navigation mutates nothing', () => {
  it('issues no document edit while extending and collapsing', () => {
    const { editAsync } = mount()
    clickParagraph('p1')
    placeCaret(5)
    shiftKey('ArrowRight')
    // Contracting back onto the anchor collapses the selection rather than
    // keeping a live range, and the plain arrow then moves the caret natively.
    shiftKey('ArrowLeft')
    plainKey('ArrowRight')
    expect(editAsync).not.toHaveBeenCalled()
    // The plain arrow crossed into the next paragraph, so the caret moved but
    // the document did not change.
    expect(selectionStatus()).toBe('')
    expect(screen.getByLabelText('Paragraph text')).toHaveProperty(
      'value',
      'Bravo',
    )
  })

  it('leaves the paragraph on Escape when nothing is selected', () => {
    mount()
    clickParagraph('p1')
    placeCaret(3)
    plainKey('Escape')
    // Focus left the paragraph; no editor owns the caret any more.
    expect(screen.queryByLabelText('Paragraph text')).toBeNull()
  })
})
