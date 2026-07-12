import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from '../badge'
import { Button } from '../button'

describe('Button', () => {
  it('renders its label as an accessible button', () => {
    render(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.tagName).toBe('BUTTON')
  })

  it('applies variant classes and merges a caller className', () => {
    render(
      <Button variant="secondary" className="mt-4">
        Save
      </Button>,
    )
    const button = screen.getByRole('button')
    expect(button.className).toContain('mt-4')
    expect(button.className).toContain('border-line')
  })

  it('disables the button while loading', () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('defaults to type="button" so it never accidentally submits a form', () => {
    render(<Button>Save</Button>)
    expect((screen.getByRole('button') as HTMLButtonElement).type).toBe(
      'button',
    )
  })
})

describe('Badge', () => {
  it('renders children and the neutral tone by default', () => {
    render(<Badge>Live</Badge>)
    const badge = screen.getByText('Live')
    expect(badge.className).toContain('bg-surface')
  })

  it('applies the danger tone', () => {
    render(<Badge tone="danger">Failed</Badge>)
    expect(screen.getByText('Failed').className).toContain('bg-danger')
  })
})
