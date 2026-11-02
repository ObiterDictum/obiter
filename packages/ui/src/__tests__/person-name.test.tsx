import '@obiter/test-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  FORMER_MEMBER_MARKER,
  PersonName,
  formerMemberName,
} from '../person-name'

afterEach(cleanup)

describe('formerMemberName', () => {
  it('marks a former member after the name so a reader knows they have left', () => {
    expect(formerMemberName('Alex Morgan', true)).toBe(
      'Alex Morgan (former member)',
    )
  })

  it('leaves a current member and an unflagged name unmarked', () => {
    expect(formerMemberName('Alex Morgan', false)).toBe('Alex Morgan')
    expect(formerMemberName('Alex Morgan')).toBe('Alex Morgan')
  })
})

describe('PersonName', () => {
  it('renders the marker in muted text that assistive technology still reads', () => {
    render(<PersonName person={{ name: 'Alex Morgan', formerMember: true }} />)
    expect(screen.getByText('Alex Morgan').textContent).toBe(
      'Alex Morgan (former member)',
    )
    const marker = screen.getByText(FORMER_MEMBER_MARKER)
    expect(marker.getAttribute('aria-hidden')).toBeNull()
    expect(marker.className).toContain('text-muted')
  })

  it('renders only the name for a current member', () => {
    render(<PersonName person={{ name: 'Alex Morgan' }} />)
    expect(screen.getByText('Alex Morgan').textContent).toBe('Alex Morgan')
    expect(screen.queryByText(FORMER_MEMBER_MARKER)).toBeNull()
  })
})
