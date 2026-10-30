import '@obiter/test-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
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

describe('Select controlled state', () => {
  it('stays controlled when its first value arrives, so Base UI logs no warning', () => {
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args)
    })
    const options = [{ value: 'ew', label: 'England and Wales' }]
    const { rerender } = render(
      <Select label="Jurisdiction" options={options} />,
    )
    rerender(<Select label="Jurisdiction" options={options} value="ew" />)

    expect(
      errors.filter((args) =>
        args.some((arg) => /uncontrolled to be controlled/i.test(String(arg))),
      ),
    ).toEqual([])
    spy.mockRestore()
  })
})
