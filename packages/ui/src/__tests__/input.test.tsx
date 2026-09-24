import '@obiter/test-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { createRef } from 'react'
import { Input } from '../input'

describe('Input', () => {
  it('associates the label with the input via htmlFor/id', () => {
    render(<Input label="Email" />)
    const input = screen.getByLabelText('Email')
    expect(input.tagName).toBe('INPUT')
  })

  it('marks the field invalid and describes the error when error is set', () => {
    render(<Input label="Email" error="Invalid address" />)
    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Invalid address').tagName).toBe('P')
  })

  it('forwards a ref to the input element so a form can focus it', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input label="Name" ref={ref} />)
    expect(ref.current).toBe(screen.getByLabelText('Name'))
  })

  it('renders helper text when there is no error', () => {
    render(<Input label="Email" helperText="We never share this." />)
    expect(screen.getByText('We never share this.').tagName).toBe('P')
    expect(
      screen.getByLabelText('Email').getAttribute('aria-invalid'),
    ).toBeNull()
  })
})
