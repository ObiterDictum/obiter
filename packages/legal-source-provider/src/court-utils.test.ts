import { describe, expect, it } from 'vitest'
import { courtFromFindCaseLawPath } from './court-utils'

describe('Find Case Law court paths', () => {
  it('resolves the renamed court paths the feed still serves', () => {
    // Measured against the live feed: `court=ewhc-kb` returns documents under
    // `/ewhc/qb/`, and `court=ewhc-scco` returns them under `/ewhc/costs/`.
    // Without the aliases the court derived from a document's own path
    // disagrees with the collection it was retrieved from.
    expect(courtFromFindCaseLawPath('ewhc/qb')).toBe('ewhc-kb')
    expect(courtFromFindCaseLawPath('ewhc/costs')).toBe('ewhc-scco')
  })

  it('still resolves the current paths', () => {
    expect(courtFromFindCaseLawPath('ewhc/kb')).toBe('ewhc-kb')
    expect(courtFromFindCaseLawPath('uksc')).toBe('uksc')
    expect(courtFromFindCaseLawPath('ukut/iac')).toBe('ukut-iac')
  })
})
