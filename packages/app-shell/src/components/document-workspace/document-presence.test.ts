import { describe, expect, it } from 'bun:test'
import {
  presenceLabel,
  presencePeople,
  visiblePresence,
} from './document-presence'

const names = new Map([
  ['usr_2', 'Priya Raman'],
  ['usr_3', 'Tom Okafor'],
])

function participant(userId: string, editing: boolean) {
  return {
    userId,
    clientId: `${userId}-client`,
    cursor: editing ? { paragraphId: 'p1', runId: 'r1', offset: 4 } : null,
  }
}

describe('document presence', () => {
  it('shows nobody when you are the only person in the document', () => {
    expect(
      presencePeople([participant('usr_1', true)], 'usr_1', names),
    ).toEqual([])
  })

  it('names other people and marks a placed caret as editing', () => {
    expect(
      presencePeople(
        [participant('usr_2', true), participant('usr_3', false)],
        'usr_1',
        names,
      ),
    ).toEqual([
      {
        userId: 'usr_2',
        name: 'Priya Raman',
        initials: 'PR',
        activity: 'editing',
      },
      {
        userId: 'usr_3',
        name: 'Tom Okafor',
        initials: 'TO',
        activity: 'viewing',
      },
    ])
  })

  it('counts one person once when they have two sessions open', () => {
    const people = presencePeople(
      [
        { userId: 'usr_2', clientId: 'a', cursor: null },
        { userId: 'usr_2', clientId: 'b', cursor: null },
      ],
      'usr_1',
      names,
    )
    expect(people).toHaveLength(1)
  })

  it('shows the first three people and counts the rest', () => {
    const people = presencePeople(
      [
        participant('usr_2', false),
        participant('usr_3', false),
        participant('usr_4', false),
        participant('usr_5', false),
        participant('usr_6', false),
      ],
      'usr_1',
      names,
    )
    const { shown, hiddenCount } = visiblePresence(people)
    expect(shown).toHaveLength(3)
    expect(hiddenCount).toBe(2)
  })

  it('describes the other people in words for assistive technology', () => {
    const people = presencePeople(
      [participant('usr_2', true), participant('usr_3', false)],
      'usr_1',
      names,
    )
    expect(presenceLabel(people)).toBe('2 other people are in this document')
    expect(presenceLabel([people[0]!])).toBe('1 other person is editing')
  })
})
