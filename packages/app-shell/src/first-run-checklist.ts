import type { UserRole } from '@obiter/contracts'

const firstRunDismissedPrefix = 'obiter.first-run-checklist.dismissed'

export type FirstRunAudience = 'admin' | 'member'

export type FirstRunStepId =
  'invite' | 'matter' | 'upload' | 'verify' | 'search'

export interface FirstRunSignals {
  hasInviteOrSecondMember: boolean
  hasMatter: boolean
  hasDocument: boolean
  hasVerificationRun: boolean
  hasRedactionRun: boolean
  hasRecentSearch: boolean
}

export interface FirstRunStep {
  id: FirstRunStepId
  title: string
  description: string
  done: boolean
}

export function firstRunAudience(
  role: UserRole | null | undefined,
): FirstRunAudience {
  return role === 'owner' || role === 'admin' ? 'admin' : 'member'
}

export function firstRunSteps(
  audience: FirstRunAudience,
  signals: FirstRunSignals,
): FirstRunStep[] {
  if (audience === 'admin') {
    return [
      {
        id: 'invite',
        title: 'Invite a colleague',
        description:
          'Add someone from your organisation so matters and reviews can be shared.',
        done: signals.hasInviteOrSecondMember,
      },
      {
        id: 'matter',
        title: 'Create a matter',
        description:
          'A matter holds one client instruction: its documents, its checks and the sources you rely on.',
        done: signals.hasMatter,
      },
      {
        id: 'upload',
        title: 'Upload a document',
        description:
          'Word, PDF or text. Every save becomes a stored version you can compare.',
        done: signals.hasDocument,
      },
      {
        id: 'verify',
        title: 'Run Verify on a document',
        description:
          'Verify checks a document’s citations and quotations against stored UK sources.',
        done: signals.hasVerificationRun,
      },
    ]
  }

  return [
    {
      id: 'matter',
      title: 'Create or open a matter',
      description:
        'A matter holds one client instruction: its documents, its checks and the sources you rely on.',
      done: signals.hasMatter,
    },
    {
      id: 'upload',
      title: 'Upload a document',
      description:
        'Word, PDF or text. Every save becomes a stored version you can compare.',
      done: signals.hasDocument,
    },
    {
      id: 'search',
      title: 'Try a search',
      description:
        'Search UK case law and legislation, then keep a source with the matter it belongs to.',
      done: signals.hasRecentSearch,
    },
    {
      id: 'verify',
      title: 'Run Verify or Redact on a document',
      description:
        'Both start from a document. Verify reads it for citations; Redact finds the personal details in it.',
      done: signals.hasVerificationRun || signals.hasRedactionRun,
    },
  ]
}

export function firstRunProgress(steps: readonly FirstRunStep[]) {
  return {
    done: steps.filter((step) => step.done).length,
    total: steps.length,
  }
}

export function firstRunComplete(steps: readonly FirstRunStep[]) {
  return steps.length > 0 && steps.every((step) => step.done)
}

function firstRunDismissedKey(userId: string) {
  return `${firstRunDismissedPrefix}:${userId}`
}
export function readFirstRunDismissed(
  storage: Pick<Storage, 'getItem'> | undefined,
  userId: string,
) {
  if (!storage) return false
  try {
    return storage.getItem(firstRunDismissedKey(userId)) === 'true'
  } catch {
    return false
  }
}

export function rememberFirstRunDismissed(
  storage: Pick<Storage, 'setItem'> | undefined,
  userId: string,
) {
  if (!storage) return
  try {
    storage.setItem(firstRunDismissedKey(userId), 'true')
  } catch {
    return
  }
}
