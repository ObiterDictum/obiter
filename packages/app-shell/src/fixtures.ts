import { queryOptions } from '@tanstack/react-query'
import type { AppPlatform, MeResponse, ShellSnapshot } from '@ormont/contracts'

/**
 * Phase 0 fixture layer. Still powers the Home/Matters demo views while M2
 * rewires them to real data. `createPhaseZeroShellSnapshot`, the demo me
 * response, and this module are deleted outright in M2 (PRD FR7).
 *
 * Do not expand this path. New behaviour must not depend on fixtures.
 */

export function createDemoMeResponse(): MeResponse {
  return {
    user: {
      id: 'user-amorgan',
      email: 'amorgan@obiter.local',
      name: 'A. Morgan',
      role: 'owner',
    },
    organisation: {
      id: 'org-obiter-demo',
      name: 'Obiter Legal',
      plan: 'private_beta',
    },
  }
}

export function createPhaseZeroShellSnapshot(platform: AppPlatform): ShellSnapshot {
  return {
    platform,
    organisation: {
      ...createDemoMeResponse().organisation,
      seatCount: 1,
    },
    currentUser: createDemoMeResponse().user,
    matters: [],
    featuredMatterId: '',
    metrics: [],
    milestones: [
      {
        id: 'milestone-auth',
        label: '0.2 Auth foundation',
        detail: 'Sign-in, organisation context, and protected shell routes.',
        status: 'active',
      },
    ],
    alerts: [],
  }
}

export function findMatterRecord(snapshot: ShellSnapshot, matterId: string) {
  return snapshot.matters.find((matter) => matter.id === matterId)
}

export function canSeeDevelopmentStatus(me: MeResponse) {
  return me.organisation.id === 'org-obiter-demo' && me.user.role === 'owner'
}

export function canSeeStaffNavigation(me: MeResponse) {
  return canSeeDevelopmentStatus(me)
}

export function shellSnapshotQueryOptions(platform: AppPlatform) {
  return queryOptions({
    queryKey: ['phase-0-shell', platform],
    queryFn: async () => createPhaseZeroShellSnapshot(platform),
    staleTime: Infinity,
  })
}

/** Demo current-user for the (still-fixture) Home view. M2 deletes this. */
export function demoCurrentUserQueryOptions() {
  return queryOptions({
    queryKey: ['phase-0-current-user'],
    queryFn: async () => createDemoMeResponse(),
    staleTime: Infinity,
  })
}
