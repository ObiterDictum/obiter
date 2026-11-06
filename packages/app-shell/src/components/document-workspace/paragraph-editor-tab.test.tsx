import '@obiter/test-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import { ParagraphEditor } from './paragraph-editor'

afterEach(() => {
  cleanup()
})

function editor(cells: {
  previousCell?: { id: string; text: string; lines: [] }
  nextCell?: { id: string; text: string; lines: [] }
}) {
  const moves: [string, number][] = []
  render(
    <ParagraphEditor
      paragraphId="cell-b"
      text="Cell B"
      selected
      lines={[]}
      {...cells}
      onSelect={() => undefined}
      onMoveCell={(id, offset) => moves.push([id, offset])}
      onChangeText={() => undefined}
      onBackspace={() => undefined}
      onDelete={() => undefined}
      onEnter={() => undefined}
      onLineBreak={() => undefined}
      onInsertTab={() => undefined}
    />,
  )
  return { moves, field: screen.getByLabelText('Paragraph text') }
}

describe('Tab in a table cell', () => {
  it('moves the caret to the end of the next cell, and Shift+Tab to the previous one', () => {
    const { moves, field } = editor({
      previousCell: { id: 'cell-a', text: 'Cell A', lines: [] },
      nextCell: { id: 'cell-c', text: 'Cell C text', lines: [] },
    })
    expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(false)
    expect(fireEvent.keyDown(field, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(moves).toEqual([
      ['cell-c', 11],
      ['cell-a', 6],
    ])
  })

  it('does not move between cells outside a table', () => {
    const { moves, field } = editor({})
    fireEvent.keyDown(field, { key: 'Tab' })
    expect(moves).toEqual([])
  })
})
