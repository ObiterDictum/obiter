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

  it('names the source a judgment or provision page is showing', () => {
    expect(
      breadcrumbTrail(
        '/case/rock-advertising-v-mwb-business-exchanges',
        null,
        'Rock Advertising Ltd v MWB Business Exchange Centres Ltd',
      ),
    ).toEqual([
      { label: 'Search', to: '/search' },
      { label: 'Rock Advertising Ltd v MWB Business Exchange Centres Ltd' },
    ])
    expect(
      breadcrumbTrail(
        '/ln/ukpga/2010/15/section/13',
        null,
        's. 13 · Equality Act 2010',
      ),
    ).toEqual([
      { label: 'Search', to: '/search' },
      { label: 's. 13 · Equality Act 2010' },
    ])
    expect(breadcrumbTrail('/case/rock-advertising', null, null)).toEqual([
      { label: 'Search' },
    ])
  })

  it('names the page itself on an unknown path, so no crumb ends in a chevron', () => {
    expect(breadcrumbTrail('/no-such-page', null)).toEqual([
      { label: 'Page not found' },
    ])
  })

  it('names the open settings section under the Settings crumb', () => {
    expect(
      breadcrumbTrail('/settings', null, null, {
        settingsSection: 'Preferences',
      }),
    ).toEqual([{ label: 'Settings' }, { label: 'Preferences' }])
    expect(breadcrumbTrail('/settings', null)).toEqual([{ label: 'Settings' }])
  })

  it('trails the staff area to Access review', () => {
    expect(breadcrumbTrail('/staff', null, null, { staff: true })).toEqual([
      { label: 'Staff', to: '/staff' },
      { label: 'Access review' },
    ])
    expect(
      breadcrumbTrail('/staff/access', null, null, { staff: true }),
    ).toEqual([{ label: 'Staff', to: '/staff' }, { label: 'Access review' }])
  })

  it('hides the staff area from people who are not staff', () => {
    expect(breadcrumbTrail('/staff', null, null, { staff: false })).toEqual([
      { label: 'Page not found' },
    ])
    expect(
      breadcrumbTrail('/staff/access', null, null, { staff: false }),
    ).toEqual([{ label: 'Page not found' }])
  })
})
