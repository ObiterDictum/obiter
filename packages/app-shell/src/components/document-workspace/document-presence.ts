import type { DocumentPresence } from '@obiter/contracts'
import { initialsOf } from '../../format'

type PresenceActivity = 'viewing' | 'editing'

export interface PresencePerson {
  userId: string
  name: string
  initials: string
  activity: PresenceActivity
}

const PRESENCE_AVATAR_LIMIT = 3

const UNKNOWN_NAME = 'A colleague'

export function presencePeople(
  presence: readonly DocumentPresence[],
  currentUserId: string | undefined,
  names: ReadonlyMap<string, string>,
): PresencePerson[] {
  const activityByUser = new Map<string, PresenceActivity>()
  for (const participant of presence) {
    if (participant.userId === currentUserId) continue
    if (activityByUser.get(participant.userId) === 'editing') continue
    activityByUser.set(
      participant.userId,
      participant.cursor ? 'editing' : 'viewing',
    )
  }
  return [...activityByUser].map(([userId, activity]) => {
    const name = names.get(userId) ?? UNKNOWN_NAME
    return { userId, name, initials: initialsOf(name), activity }
  })
}

export function visiblePresence(
  people: readonly PresencePerson[],
  limit = PRESENCE_AVATAR_LIMIT,
) {
  return {
    shown: people.slice(0, limit),
    hiddenCount: Math.max(people.length - limit, 0),
  }
}

export function presenceLabel(people: readonly PresencePerson[]): string {
  const editing = people.filter((person) => person.activity === 'editing')
  if (editing.length === 0) {
    return people.length === 1
      ? '1 other person is viewing'
      : `${String(people.length)} other people are viewing`
  }
  if (editing.length === people.length) {
    return people.length === 1
      ? '1 other person is editing'
      : `${String(people.length)} other people are editing`
  }
  return `${String(people.length)} other people are in this document`
}
