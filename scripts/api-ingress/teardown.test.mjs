import { describe, expect, it } from 'bun:test'

import { teardownResources } from './ingress.mjs'

/**
 * A teardown with injected docker operations, so the failure paths can be
 * exercised without starting a container or touching the host.
 */
function harness({
  existing = [],
  failRemoval = [],
  scratchFails = false,
} = {}) {
  const removed = []
  const scratchRemoved = []
  return {
    removed,
    scratchRemoved,
    deps: {
      resources: [
        { type: 'network', name: 'net' },
        { type: 'container', name: 'one' },
        { type: 'container', name: 'two' },
      ],
      scratch: '/tmp/scratch',
      exists: (resource) => existing.includes(resource.name),
      removeContainer: (name) => {
        if (failRemoval.includes(name)) throw new Error(`cannot remove ${name}`)
        removed.push(name)
      },
      networkRemove: (name) => {
        if (failRemoval.includes(name)) throw new Error(`cannot remove ${name}`)
        removed.push(name)
      },
      removeScratch: async (dir) => {
        if (scratchFails) throw new Error('scratch busy')
        scratchRemoved.push(dir)
      },
    },
  }
}

describe('teardownResources', () => {
  it('removes existing resources in reverse creation order and the scratch dir', async () => {
    const { deps, removed, scratchRemoved } = harness({
      existing: ['net', 'one', 'two'],
    })

    expect(await teardownResources(deps)).toEqual([])
    expect(removed).toEqual(['two', 'one', 'net'])
    expect(scratchRemoved).toEqual(['/tmp/scratch'])
  })

  it('skips a resource that was never created rather than failing on it', async () => {
    const { deps, removed } = harness({ existing: ['net'] })

    expect(await teardownResources(deps)).toEqual([])
    expect(removed).toEqual(['net'])
  })

  it('reports a removal failure with the resource name instead of claiming success', async () => {
    const { deps } = harness({
      existing: ['net', 'one', 'two'],
      failRemoval: ['one'],
    })

    const failures = await teardownResources(deps)

    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('container one')
    expect(failures[0]).toContain('cannot remove one')
  })

  it('reports a scratch directory that could not be removed', async () => {
    const { deps } = harness({ existing: ['net'], scratchFails: true })

    expect(await teardownResources(deps)).toEqual([
      'scratch /tmp/scratch: scratch busy',
    ])
  })
})
