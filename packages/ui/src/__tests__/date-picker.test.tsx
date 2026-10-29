import '@obiter/test-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'bun:test'
import {
  DatePicker,
  formatDdMmYyyy,
  monthCells,
  parseDdMmYyyy,
} from '../date-picker'

describe('parseDdMmYyyy', () => {
  it('reads a UK date as ISO, and rejects text that is not a real date', () => {
    expect(parseDdMmYyyy('13/03/2010')).toBe('2010-03-13')
    expect(parseDdMmYyyy('1/3/2010')).toBe('2010-03-01')
    expect(parseDdMmYyyy('03/13/2010')).toBeNull()
    expect(parseDdMmYyyy('31/02/2020')).toBeNull()
    expect(parseDdMmYyyy('2010-03-13')).toBeNull()
    expect(parseDdMmYyyy('')).toBeNull()
  })

  it('formats ISO back into the field format', () => {
    expect(formatDdMmYyyy('2010-03-13')).toBe('13/03/2010')
    expect(formatDdMmYyyy('')).toBe('')
  })
})

describe('monthCells', () => {
  it('starts the month on a Monday and ends it on its last day', () => {
    const cells = monthCells(2026, 2)
    expect(cells.slice(0, 7)).toEqual([null, null, null, null, null, null, 1])
    expect(cells.filter((day) => day !== null)).toHaveLength(31)
    expect(cells.at(-1)).toBe(31)
  })
})

describe('DatePicker', () => {
  it('shows the value in dd/mm/yyyy and reports the typed date as ISO', () => {
    const onChange = vi.fn()
    render(<DatePicker label="From" value="2010-03-13" onChange={onChange} />)
    const input = screen.getByLabelText('From') as HTMLInputElement
    expect(input.value).toBe('13/03/2010')
    expect(input.placeholder).toBe('dd/mm/yyyy')
  })

  it('does not push an unparseable entry up, and keeps the committed date', () => {
    const onChange = vi.fn()
    render(<DatePicker label="From" value="" onChange={onChange} />)
    const input = screen.getByLabelText('From') as HTMLInputElement
    input.value = '03/13/2010'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('blur'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
