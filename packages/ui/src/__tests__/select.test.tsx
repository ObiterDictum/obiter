import '@obiter/test-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { Select } from '../select'

describe('Select accessibility', () => {
  it('names the trigger with its visible label and exposes invalid state', () => {
    render(
      <Select
        label="Jurisdiction"
        invalid
        options={[{ value: 'ew', label: 'England and Wales' }]}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: 'Jurisdiction' })
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
  })

  it('names an unlabelled trigger with its placeholder', () => {
    render(<Select placeholder="Choose jurisdiction" options={[]} />)
    expect(
      screen.getByRole('combobox', { name: 'Choose jurisdiction' }),
    ).toBeTruthy()
  })
})
