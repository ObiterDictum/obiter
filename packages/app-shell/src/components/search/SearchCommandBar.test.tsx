// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchCommandBar } from './SearchCommandBar'

const baseProps = {
  activeFilterCount: 0,
  courtLabel: 'All courts and tribunals',
  dateFrom: '',
  dateTo: '',
  isSearching: false,
  onFilterClick: vi.fn(),
  onQueryChange: vi.fn(),
  onRemoveFilter: vi.fn(),
  onSubmit: vi.fn(),
  query: '',
}

describe('SearchCommandBar accessibility', () => {
  it('exposes the search input under an accessible name derived from its label', () => {
    render(<SearchCommandBar {...baseProps} />)

    const input = screen.getByRole('searchbox', {
      name: /search legal sources/i,
    })
    expect(input.tagName).toBe('INPUT')
  })

  it('associates the label with the input via htmlFor/id so the name is programmatic', () => {
    const { container } = render(<SearchCommandBar {...baseProps} />)

    const input = container.querySelector<HTMLInputElement>(
      'input[name="query"]',
    )
    const label = container.querySelector<HTMLLabelElement>('label.sr-only')

    expect(label?.getAttribute('for')).toBe(input?.id)
    expect(input?.getAttribute('aria-labelledby')).toBeNull()
  })
})
