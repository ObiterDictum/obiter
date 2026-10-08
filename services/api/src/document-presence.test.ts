import { describe, expect, it } from 'bun:test'

import {
  DocumentPresenceRegistry,
  type DocumentPresenceScope,
} from './document-presence'

const cursor = { paragraphId: 'para_1', runId: 'run_1', offset: 1 }

function scope(overrides: Partial<DocumentPresenceScope> = {}) {
  return {
    organisationId: 'org_1',
    matterId: 'mat_1',
    documentId: 'doc_1',
    versionId: 'ver_1',
    userId: 'usr_1',
    clientId: 'tab_1',
    ...overrides,
  }
}

function readScope(overrides: Partial<DocumentPresenceScope> = {}) {
  const { organisationId, documentId, versionId } = scope(overrides)
  return { organisationId, documentId, versionId }
}

describe('DocumentPresenceRegistry', () => {
  it('expires entries after fifteen seconds and scopes them by organisation', () => {
    let now = 1_000
    const registry = new DocumentPresenceRegistry(() => now)
    registry.update(scope(), cursor)

    expect(registry.read(readScope())).toEqual([
      { userId: 'usr_1', clientId: 'tab_1', cursor },
    ])
    expect(registry.read(readScope({ organisationId: 'org_2' }))).toEqual([])

    now += 15_000
    expect(registry.read(readScope())).toEqual([])
  })

  it('scopes cursors to the version they were heartbeated against', () => {
    const registry = new DocumentPresenceRegistry()
    registry.update(scope({ versionId: 'ver_old' }), cursor)

    expect(registry.read(readScope({ versionId: 'ver_old' }))).toHaveLength(1)
    expect(registry.read(readScope({ versionId: 'ver_current' }))).toEqual([])
  })

  it('keeps two tabs of one account as distinct participants', () => {
    const registry = new DocumentPresenceRegistry()
    registry.update(scope({ clientId: 'tab_a' }), cursor)
    registry.update(scope({ clientId: 'tab_b' }), { ...cursor, offset: 2 })

    expect(registry.read(readScope())).toEqual([
      { userId: 'usr_1', clientId: 'tab_a', cursor },
      {
        userId: 'usr_1',
        clientId: 'tab_b',
        cursor: { ...cursor, offset: 2 },
      },
    ])

    // Leaving one tab removes only that tab's row.
    registry.update(scope({ clientId: 'tab_a' }), null)
    expect(registry.read(readScope())).toEqual([
      {
        userId: 'usr_1',
        clientId: 'tab_b',
        cursor: { ...cursor, offset: 2 },
      },
    ])
  })

  it('caps each document at fifty active users without retaining cursor references', () => {
    let now = 0
    const registry = new DocumentPresenceRegistry(() => now)
    let submitted = cursor
    for (let index = 0; index <= 50; index += 1) {
      submitted = { ...cursor, offset: index }
      registry.update(
        scope({ userId: `usr_${String(index).padStart(2, '0')}` }),
        submitted,
      )
      now += 1
    }
    submitted.offset = 99

    const participants = registry.read(readScope())
    expect(participants).toHaveLength(50)
    expect(participants.some(({ userId }) => userId === 'usr_00')).toBe(false)
    expect(participants.some(({ cursor: value }) => value?.offset === 99)).toBe(
      false,
    )
  })

  it('caps process-local document buckets at one thousand', () => {
    const registry = new DocumentPresenceRegistry(() => 0)
    for (let index = 0; index <= 1_000; index += 1) {
      registry.update(scope({ documentId: `doc_${index}` }), cursor)
    }

    expect(registry.read(readScope({ documentId: 'doc_0' }))).toEqual([])
    expect(registry.read(readScope({ documentId: 'doc_1000' }))).toHaveLength(1)
  })
})
