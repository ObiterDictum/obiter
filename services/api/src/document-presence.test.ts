import { describe, expect, it } from 'vitest'

import { DocumentPresenceRegistry } from './document-presence'

const cursor = { paragraphId: 'para_1', runId: 'run_1', offset: 1 }

describe('DocumentPresenceRegistry', () => {
  it('expires entries after fifteen seconds and scopes them by organisation', () => {
    let now = 1_000
    const registry = new DocumentPresenceRegistry(() => now)
    registry.update('org_1', 'doc_1', 'usr_1', cursor)

    expect(registry.read('org_1', 'doc_1')).toEqual([
      { userId: 'usr_1', cursor },
    ])
    expect(registry.read('org_2', 'doc_1')).toEqual([])

    now += 15_000
    expect(registry.read('org_1', 'doc_1')).toEqual([])
  })

  it('caps each document at fifty active users without retaining cursor references', () => {
    let now = 0
    const registry = new DocumentPresenceRegistry(() => now)
    let submitted = cursor
    for (let index = 0; index <= 50; index += 1) {
      submitted = { ...cursor, offset: index }
      registry.update(
        'org_1',
        'doc_1',
        `usr_${String(index).padStart(2, '0')}`,
        submitted,
      )
      now += 1
    }
    submitted.offset = 99

    const participants = registry.read('org_1', 'doc_1')
    expect(participants).toHaveLength(50)
    expect(participants.some(({ userId }) => userId === 'usr_00')).toBe(false)
    expect(participants.some(({ cursor: value }) => value?.offset === 99)).toBe(
      false,
    )
  })

  it('caps process-local document buckets at one thousand', () => {
    const registry = new DocumentPresenceRegistry(() => 0)
    for (let index = 0; index <= 1_000; index += 1) {
      registry.update('org_1', `doc_${index}`, 'usr_1', cursor)
    }

    expect(registry.read('org_1', 'doc_0')).toEqual([])
    expect(registry.read('org_1', 'doc_1000')).toHaveLength(1)
  })
})
