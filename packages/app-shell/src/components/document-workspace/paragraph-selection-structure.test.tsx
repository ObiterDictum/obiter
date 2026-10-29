import '@obiter/test-dom'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  mountWorkspace,
  paragraph,
  tabledBodyModel,
} from './docx-workspace-harness'
import {
  bodyField,
  clickParagraph,
  placeCaret,
  selectedMarkCount,
  selectionStatus,
} from './paragraph-selection-harness'

function mount(model = tabledBodyModel()) {
  const editAsync = vi.fn()
  mountWorkspace({ models: { doc_1: model }, editAsync })
  return { editAsync }
}

function shiftRight() {
  const field = bodyField()
  const notPrevented = fireEvent.keyDown(field, {
    key: 'ArrowRight',
    shiftKey: true,
  })
  return { field, notPrevented }
}

function shiftLeft() {
  const field = bodyField()
  const notPrevented = fireEvent.keyDown(field, {
    key: 'ArrowLeft',
    shiftKey: true,
  })
  return { field, notPrevented }
}

describe('extending a selection towards a table', () => {
  it('stops at the first cell and says why', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    const { notPrevented } = shiftRight()
    expect(notPrevented).toBe(false)
    expect(selectionStatus()).toMatch(/cannot cross a table/)
    expect(selectedMarkCount()).toBe(0)
    expect(bodyField().value).toBe('Alpha')
  })

  it('stops at the last cell approaching from the body side that follows', () => {
    mount()
    clickParagraph('p4')
    placeCaret(0)
    const { notPrevented } = shiftLeft()
    expect(notPrevented).toBe(false)
    expect(selectionStatus()).toMatch(/cannot cross a table/)
    expect(selectedMarkCount()).toBe(0)
    expect(bodyField().value).toBe('Delta')
  })

  it('keeps a body selection alive while refusing the crossing', () => {
    mount()
    clickParagraph('p1')
    placeCaret(2)
    const field = bodyField()
    field.focus()
    field.setSelectionRange(2, 5)
    fireEvent.select(field)
    fireEvent.mouseUp(field)
    expect(selectionStatus()).toMatch(/1 paragraph selected/)
    const { notPrevented } = shiftRight()
    expect(notPrevented).toBe(false)
    expect(selectionStatus()).toMatch(/cannot cross a table/)
  })
})

describe('select all with a table in the body', () => {
  it('refuses instead of bridging the cells', () => {
    mount()
    clickParagraph('p1')
    placeCaret(2)
    const notPrevented = fireEvent.keyDown(bodyField(), {
      key: 'a',
      ctrlKey: true,
    })
    expect(notPrevented).toBe(false)
    expect(selectionStatus()).toMatch(/cannot cross a table/)
    expect(selectedMarkCount()).toBe(0)
  })
})

describe('plain arrow navigation at a table', () => {
  it('does not move the caret into a cell', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    fireEvent.keyDown(bodyField(), { key: 'ArrowRight' })
    expect(bodyField().value).toBe('Alpha')
  })

  it('stops before an empty cell as well', () => {
    mount(emptyCellModel())
    clickParagraph('p1')
    placeCaret(5)
    shiftRight()
    expect(selectionStatus()).toMatch(/cannot cross a table/)
    expect(selectedMarkCount()).toBe(0)
  })
})

describe('a single caret at a table boundary', () => {
  function save() {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('refuses Delete at the end of the body paragraph before the table', () => {
    const { editAsync } = mount()
    clickParagraph('p1')
    placeCaret(5)
    const notPrevented = fireEvent.keyDown(bodyField(), { key: 'Delete' })
    expect(notPrevented).toBe(false)
    expect(selectionStatus()).toMatch(/cannot cross a table/)
    expect(bodyField().value).toBe('Alpha')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      true,
    )
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })

  it('refuses Backspace at the start of the body paragraph after the table', () => {
    const { editAsync } = mount()
    clickParagraph('p4')
    placeCaret(0)
    const notPrevented = fireEvent.keyDown(bodyField(), { key: 'Backspace' })
    expect(notPrevented).toBe(false)
    expect(selectionStatus()).toMatch(/cannot cross a table/)
    expect(bodyField().value).toBe('Delta')
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })
})

function emptyCellModel() {
  const model = tabledBodyModel()
  const story = model.stories[0]
  if (!story) return model
  return {
    ...model,
    stories: [
      {
        ...story,
        paragraphs: story.paragraphs.map((item) =>
          item.id === 'para-w14-CELL0001' ? paragraph(item.id, '') : item,
        ),
      },
    ],
  }
}
