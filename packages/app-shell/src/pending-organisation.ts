import { PERSONAL_WORKSPACE_NAME, type MeResponse } from '@obiter/contracts'
import { apiFetch, ApiError } from './api'

const PENDING_KEY = 'obiter.pendingOrganisationName'

/** Stashes the organisation name typed at sign-up until the first sign-in. */
export function savePendingOrganisationName(name: string) {
  try {
    window.localStorage.setItem(PENDING_KEY, name)
  } catch {
    // Private-mode storage failure: the workspace falls back to the default
    // name and the owner renames it in Settings.
  }
}

export function readPendingOrganisationName(): string | null {
  try {
    return window.localStorage.getItem(PENDING_KEY)
  } catch {
    return null
  }
}

function clearPendingOrganisationName() {
  try {
    window.localStorage.removeItem(PENDING_KEY)
  } catch {
    // Best-effort only.
  }
}

/**
 * Applies the sign-up organisation name on first use. Runs before any
 * product query where possible (sign-in): the user is still org-less, so
 * POST /api/organisations creates the tenant with the chosen name. When a
 * product surface already auto-provisioned a still-default workspace first
 * (verification-link landing, concurrent tab), the POST 409s and the owner
 * renames that fresh workspace to the chosen name instead. Either path ends
 * with the typed name; anything else leaves the workspace for Settings.
 */
export async function provisionPendingOrganisation(): Promise<boolean> {
  const name = readPendingOrganisationName()
  if (!name) return false
  try {
    await apiFetch('/api/organisations', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    clearPendingOrganisationName()
    return true
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'conflict_detected') {
      return renameDefaultWorkspace(name)
    }
    return false
  }
}

async function renameDefaultWorkspace(name: string): Promise<boolean> {
  try {
    const me = await apiFetch<MeResponse>('/api/me')
    if (
      !me.organisation ||
      me.organisation.name !== PERSONAL_WORKSPACE_NAME ||
      me.user.role !== 'owner'
    ) {
      clearPendingOrganisationName()
      return false
    }
    await apiFetch(`/api/organisations/${me.organisation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
    clearPendingOrganisationName()
    return true
  } catch {
    return false
  }
}
