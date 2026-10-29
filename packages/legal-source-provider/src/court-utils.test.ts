import { describe, expect, it } from 'bun:test'
import { courtFromFindCaseLawPath } from './court-utils'

describe('Find Case Law court paths', () => {
  it('resolves the renamed court paths the feed still serves', () => {
    expect(courtFromFindCaseLawPath('ewhc/qb')).toBe('ewhc-kb')
    expect(courtFromFindCaseLawPath('ewhc/costs')).toBe('ewhc-scco')
  })

  it('still resolves the current paths', () => {
    expect(courtFromFindCaseLawPath('ewhc/kb')).toBe('ewhc-kb')
    expect(courtFromFindCaseLawPath('uksc')).toBe('uksc')
    expect(courtFromFindCaseLawPath('ukut/iac')).toBe('ukut-iac')
  })
})
