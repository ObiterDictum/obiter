import { describe, expect, it } from 'bun:test'
import {
  firstRunAudience,
  firstRunComplete,
  firstRunProgress,
  firstRunSteps,
  readFirstRunDismissed,
  readFirstRunSearched,
  rememberFirstRunDismissed,
  rememberFirstRunSearched,
  type FirstRunSignals,
} from './first-run-checklist'

const nothingDone: FirstRunSignals = {
  hasInviteOrSecondMember: false,
  hasMatter: false,
  hasDocument: false,
  hasVerificationRun: false,
  hasRedactionRun: false,
  hasRecentSearch: false,
}

const everythingDone: FirstRunSignals = {
  hasInviteOrSecondMember: true,
  hasMatter: true,
  hasDocument: true,
  hasVerificationRun: true,
  hasRedactionRun: true,
  hasRecentSearch: true,
}

function ticks(steps: ReturnType<typeof firstRunSteps>) {
  return Object.fromEntries(steps.map((step) => [step.id, step.done]))
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('first-run checklist audience', () => {
  it('treats owners and admins as organisation admins', () => {
    expect(firstRunAudience('owner')).toBe('admin')
    expect(firstRunAudience('admin')).toBe('admin')
  })

  it('treats members and roleless users as ordinary members', () => {
    expect(firstRunAudience('member')).toBe('member')
    expect(firstRunAudience(null)).toBe('member')
  })
})

describe('first-run checklist steps', () => {
  it('ticks an admin step only from the work it stands for', () => {
    expect(ticks(firstRunSteps('admin', nothingDone))).toEqual({
      invite: false,
      matter: false,
      upload: false,
      verify: false,
    })
    expect(
      ticks(
        firstRunSteps('admin', {
          ...nothingDone,
          hasInviteOrSecondMember: true,
        }),
      ),
    ).toEqual({ invite: true, matter: false, upload: false, verify: false })
    expect(
      ticks(
        firstRunSteps('admin', { ...nothingDone, hasVerificationRun: true }),
      ),
    ).toEqual({ invite: false, matter: false, upload: false, verify: true })
  })

  it('asks admins to invite a colleague and members to search', () => {
    expect(firstRunSteps('admin', nothingDone).map((step) => step.id)).toEqual([
      'invite',
      'matter',
      'upload',
      'verify',
    ])
    expect(firstRunSteps('member', nothingDone).map((step) => step.id)).toEqual(
      ['matter', 'upload', 'search', 'verify'],
    )
  })

  it('ticks the member run step from a Redact run as well as a Verify run', () => {
    const redactOnly = firstRunSteps('member', {
      ...nothingDone,
      hasRedactionRun: true,
    })
    expect(ticks(redactOnly).verify).toBe(true)

    const verifyOnly = firstRunSteps('member', {
      ...nothingDone,
      hasVerificationRun: true,
    })
    expect(ticks(verifyOnly).verify).toBe(true)
  })

  it('counts progress from the ticks and is complete only when all are ticked', () => {
    const partial = firstRunSteps('admin', {
      ...nothingDone,
      hasMatter: true,
      hasDocument: true,
    })
    expect(firstRunProgress(partial)).toEqual({ done: 2, total: 4 })
    expect(firstRunComplete(partial)).toBe(false)

    expect(firstRunComplete(firstRunSteps('admin', everythingDone))).toBe(true)
    expect(firstRunComplete(firstRunSteps('member', everythingDone))).toBe(true)
  })
})

describe('first-run checklist dismissal', () => {
  it('remembers a dismissal per person', () => {
    const storage = memoryStorage()

    expect(readFirstRunDismissed(storage, 'usr_1')).toBe(false)
    rememberFirstRunDismissed(storage, 'usr_1')

    expect(readFirstRunDismissed(storage, 'usr_1')).toBe(true)
    expect(readFirstRunDismissed(storage, 'usr_2')).toBe(false)
  })

  it('treats unavailable or failing storage as not dismissed', () => {
    const broken = {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage disabled')
      },
    }

    expect(readFirstRunDismissed(undefined, 'usr_1')).toBe(false)
    expect(readFirstRunDismissed(broken, 'usr_1')).toBe(false)
    expect(() => rememberFirstRunDismissed(broken, 'usr_1')).not.toThrow()
  })
})

describe('first-run search step', () => {
  it('stays done across sessions once a search has run', () => {
    const storage = new Map<string, string>()
    const local = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    }
    expect(readFirstRunSearched(local)).toBe(false)
    rememberFirstRunSearched(local)
    expect(readFirstRunSearched(local)).toBe(true)
  })
})
