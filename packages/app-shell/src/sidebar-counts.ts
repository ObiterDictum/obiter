import type { VerificationRun, VerificationRunSummary } from '@obiter/contracts'
import { useMattersList, type MatterRecord } from './matters'
import { type ModuleId } from './navigation'
import { attentionRunsPerDocument, openWorkCount } from './open-work'
import { useRedactionRunsList } from './redaction-runs'
import { useOrganisationVerificationRuns } from './verification-runs'

const RECENT_MATTERS_LIMIT = 4

function verificationAttentionTone(
  runs: VerificationRun[],
): 'danger' | 'warning' | 'success' {
  const tones = attentionRunsPerDocument(runs)
    .filter((run) => run.status === 'completed')
    .map((run) => verificationAttentionToneFor(run.summary))
  if (tones.includes('danger')) return 'danger'
  if (tones.includes('warning')) return 'warning'
  return 'success'
}

function verificationAttentionToneFor(summary: VerificationRunSummary) {
  if (summary.flaggedCount > 0) return 'danger' as const
  if (summary.reviewRequiredCount > 0 || summary.notCheckedCount > 0)
    return 'warning' as const
  return 'success' as const
}

export function recentMatters(matters: MatterRecord[]): MatterRecord[] {
  return [...matters]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_MATTERS_LIMIT)
}

export function useSidebarData() {
  const matters = useMattersList().data ?? []
  const runs = useRedactionRunsList().data?.runs ?? []
  const verificationRuns = useOrganisationVerificationRuns(true).runs
  const work = openWorkCount({ verificationRuns, redactionRuns: runs })
  const counts = new Map<ModuleId, number>([
    ['matters', matters.filter((matter) => matter.status === 'active').length],
    ['verify', work.verify],
    ['redact', work.redact],
  ])
  return {
    counts,
    verifyTone: verificationAttentionTone(verificationRuns),
    recent: recentMatters(matters),
  }
}

export function moduleTone(
  module: ModuleId,
  verifyTone: 'danger' | 'warning' | 'success',
) {
  return module === 'verify' ? verifyTone : undefined
}
