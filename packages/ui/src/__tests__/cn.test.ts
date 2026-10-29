import { describe, expect, it } from 'bun:test'
import { cn } from '../lib/cn'

describe('semantic text utilities', () => {
  it('keeps a colour beside a semantic size', () => {
    expect(cn('bg-brand text-brand-fg', 'text-item')).toBe(
      'bg-brand text-brand-fg text-item',
    )
    expect(cn('text-section', 'text-ink')).toBe('text-section text-ink')
  })

  it('resolves a later size or colour without dropping the other', () => {
    expect(cn('text-body text-ink', 'text-section text-muted')).toBe(
      'text-section text-muted',
    )
    expect(cn('text-section text-ink', 'text-sm')).toBe('text-ink text-sm')
  })
})
