import { describe, expect, it } from 'vitest'
import {
  resolveStoredProvisionPath,
  type StoredProvisionPathLookup,
  type StoredLegislationProvision,
} from '../legislation-store'

/**
 * The shared store-resolution algorithm, exercised without a database. Both
 * the serving path and the authority-existence check call this function, so
 * these cases are the parity contract: a citation the Act page resolves must
 * not read as not held to verification, and the alias must never guess.
 */

function provision(
  identity: string,
  labelPath: string,
): StoredLegislationProvision {
  return {
    id: `${identity}/${labelPath}`,
    documentIdentity: identity,
    labelPath,
    label: labelPath,
    extent: '',
    text: `Text of ${labelPath}.`,
    hasUnappliedEffects: false,
    effectsCheckedAt: '2099-01-01T00:00:00.000Z',
    title: 'Test Act',
    year: 2099,
    sourceUrl: `https://www.legislation.gov.uk/${identity}`,
  }
}

function lookupFor(
  identity: string,
  labelPaths: string[],
): StoredProvisionPathLookup {
  const rows = new Map(
    labelPaths.map((labelPath) => [
      `${identity}/${labelPath}`,
      provision(identity, labelPath),
    ]),
  )
  return {
    getProvision: async (provisionId) => rows.get(provisionId) ?? null,
    pathExists: async (documentIdentity, labelPath) => {
      const prefix = `${documentIdentity}/${labelPath}`
      return [...rows.keys()].some(
        (key) => key === prefix || key.startsWith(`${prefix}/`),
      )
    },
  }
}

describe('stored provision path resolution', () => {
  it('returns the exact stored provision when it exists', async () => {
    const resolution = await resolveStoredProvisionPath(
      lookupFor('ukpga/2099/1', ['section/40']),
      'ukpga/2099/1',
      'section/40',
    )

    expect(resolution.status).toBe('held')
    if (resolution.status === 'held') {
      expect(resolution.provision.labelPath).toBe('section/40')
    }
  })

  it('maps a numbered Schedule 1 citation onto the unnumbered stored path', async () => {
    const resolution = await resolveStoredProvisionPath(
      lookupFor('ukpga/2099/4', ['schedule/paragraph/4']),
      'ukpga/2099/4',
      'schedule/1/paragraph/4',
    )

    expect(resolution.status).toBe('held')
    if (resolution.status === 'held') {
      expect(resolution.provision.labelPath).toBe('schedule/paragraph/4')
    }
  })

  it('resolves the unnumbered stored form directly', async () => {
    const resolution = await resolveStoredProvisionPath(
      lookupFor('ukpga/2099/4', ['schedule/paragraph/4']),
      'ukpga/2099/4',
      'schedule/paragraph/4',
    )

    expect(resolution.status).toBe('held')
  })

  it('never maps Schedule 2 onto an unnumbered single schedule', async () => {
    const resolution = await resolveStoredProvisionPath(
      lookupFor('ukpga/2099/4', ['schedule/paragraph/4']),
      'ukpga/2099/4',
      'schedule/2/paragraph/4',
    )

    expect(resolution).toEqual({
      status: 'missing',
      labelPath: 'schedule/2/paragraph/4',
    })
  })

  it('reports a missing paragraph of the single schedule at the alternate path', async () => {
    const resolution = await resolveStoredProvisionPath(
      lookupFor('ukpga/2099/4', ['schedule/paragraph/4']),
      'ukpga/2099/4',
      'schedule/1/paragraph/999',
    )

    expect(resolution).toEqual({
      status: 'missing',
      labelPath: 'schedule/paragraph/999',
    })
  })

  it('keeps the numbered schedule when the Act holds it', async () => {
    const resolution = await resolveStoredProvisionPath(
      lookupFor('ukpga/2099/5', [
        'schedule/1/paragraph/1',
        'schedule/2/paragraph/1',
      ]),
      'ukpga/2099/5',
      'schedule/1/paragraph/1',
    )

    expect(resolution.status).toBe('held')
    if (resolution.status === 'held') {
      expect(resolution.provision.labelPath).toBe('schedule/1/paragraph/1')
    }
  })

  it('resolves a numbered Schedule 2 the Act holds', async () => {
    const resolution = await resolveStoredProvisionPath(
      lookupFor('ukpga/2099/5', [
        'schedule/1/paragraph/1',
        'schedule/2/paragraph/1',
      ]),
      'ukpga/2099/5',
      'schedule/2/paragraph/1',
    )

    expect(resolution.status).toBe('held')
  })

  it('reports an unnumbered citation on a numbered-schedule Act as underspecified', async () => {
    const resolution = await resolveStoredProvisionPath(
      lookupFor('ukpga/2099/5', [
        'schedule/1/paragraph/1',
        'schedule/2/paragraph/1',
      ]),
      'ukpga/2099/5',
      'schedule/paragraph/1',
    )

    expect(resolution).toEqual({ status: 'underspecified' })
  })

  it('reports a genuinely absent provision as missing', async () => {
    const resolution = await resolveStoredProvisionPath(
      lookupFor('ukpga/2099/1', ['section/1']),
      'ukpga/2099/1',
      'section/99',
    )

    expect(resolution).toEqual({ status: 'missing', labelPath: 'section/99' })
  })

  it('never crosses into another Act', async () => {
    const lookup = lookupFor('ukpga/2099/1', ['section/40'])
    const resolution = await resolveStoredProvisionPath(
      lookup,
      'ukpga/2099/9',
      'section/40',
    )

    expect(resolution).toEqual({ status: 'missing', labelPath: 'section/40' })
  })
})
