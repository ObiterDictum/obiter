import { describe, expect, it } from 'bun:test'
import { breadcrumbTrail, matterIdFromPath, resolveSection } from './navigation'

describe('resolveSection', () => {
  it('names the module a path belongs to', () => {
    expect(resolveSection('/')).toBe('home')
    expect(resolveSection('/search')).toBe('search')
    expect(resolveSection('/case/wood-v-capita')).toBe('search')
    expect(resolveSection('/matters')).toBe('matters')
    expect(resolveSection('/matters/mtr_1/documents/doc_1')).toBe('matters')
    expect(resolveSection('/verify')).toBe('verify')
    expect(resolveSection('/redact/run_1')).toBe('redact')
    expect(resolveSection('/settings')).toBe('settings')
  })

  it('does not mistake a longer word for a module', () => {
    expect(resolveSection('/matters-archive')).toBe('other')
    expect(resolveSection('/search-terms')).toBe('other')
  })

  it('reads a matter id only from a matter path', () => {
    expect(matterIdFromPath('/matters/mtr_1')).toBe('mtr_1')
    expect(matterIdFromPath('/matters/mtr_1/documents/doc_1')).toBe('mtr_1')
    expect(matterIdFromPath('/matters')).toBeNull()
    expect(matterIdFromPath('/search')).toBeNull()
  })
})

describe('breadcrumbTrail', () => {
  it('ends on Home for the home route', () => {
    expect(breadcrumbTrail('/', null)).toEqual([{ label: 'Home' }])
  })

  it('does not link a module that is the current page', () => {
    expect(breadcrumbTrail('/matters', null)).toEqual([{ label: 'Matters' }])
  })

  it('links the module above a matter and names the matter', () => {
    expect(
      breadcrumbTrail('/matters/mtr_1', 'Northgate Foods v Brightwater'),
    ).toEqual([
      { label: 'Matters', to: '/matters' },
      { label: 'Northgate Foods v Brightwater' },
    ])
  })

  it('falls back to a generic label when the matter is not loaded yet', () => {
    expect(breadcrumbTrail('/matters/mtr_1', null)).toEqual([
      { label: 'Matters', to: '/matters' },
      { label: 'Matter' },
    ])
  })

  it('names the page itself on an unknown path, so no crumb ends in a chevron', () => {
    expect(breadcrumbTrail('/no-such-page', null)).toEqual([
      { label: 'Page not found' },
    ])
  })
})
