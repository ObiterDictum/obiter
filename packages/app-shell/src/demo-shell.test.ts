import { describe, expect, it } from 'vitest'
import { createPhaseZeroShellSnapshot, findMatterRecord } from './index'

describe('createPhaseZeroShellSnapshot', () => {
  it('returns the Phase 0.2 authenticated shell without placeholder matters', () => {
    const snapshot = createPhaseZeroShellSnapshot('desktop')

    expect(snapshot.platform).toBe('desktop')
    expect(snapshot.matters).toHaveLength(0)
    expect(snapshot.organisation.plan).toBe('private_beta')
  })

  it('does not invent a matter when the workspace is empty', () => {
    const snapshot = createPhaseZeroShellSnapshot('web')
    const matter = findMatterRecord(snapshot, 'missing')

    expect(matter).toBeUndefined()
  })
})
