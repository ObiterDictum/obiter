import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { render, screen } from '@testing-library/react'
import { SearchCommandBar } from './SearchCommandBar'

const baseProps = {
  isSearching: false,
  onClear: vi.fn(),
  onQueryChange: vi.fn(),
  onSubmit: vi.fn(),
  query: '',
}

describe('SearchCommandBar accessibility', () => {
  it('exposes the search input under its programmatic label', () => {
    const { container } = render(<SearchCommandBar {...baseProps} />)

    const input = screen.getByRole('searchbox', {
      name: /search case law and legislation/i,
    })
    const label = container.querySelector<HTMLLabelElement>('label.sr-only')

    expect(label?.getAttribute('for')).toBe(input.id)
    expect(input.getAttribute('name')).toBe('query')
  })

  it('offers a labelled clear control only when there is a query', () => {
    const { rerender } = render(<SearchCommandBar {...baseProps} />)
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()

    rerender(<SearchCommandBar {...baseProps} query="Mercer" />)
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy()
  })
})
