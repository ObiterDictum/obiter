const LAST_PLACE_KEY = 'obiter.workspace.lastPlace'

export type LastPlaceKind = 'matter' | 'redact' | 'search' | 'verify' | 'other'

export interface WorkspaceLastPlace {
  path: string
  label: string
  kind: LastPlaceKind
  detail?: string
  at: string
}

/** Persist the last meaningful workspace location for Home “Continue”. */
export function writeWorkspaceLastPlace(
  storage: Storage,
  place: Omit<WorkspaceLastPlace, 'at'>,
) {
  if (place.path === '/' || place.path.startsWith('/sign-')) return
  if (place.path.startsWith('/invites/')) return
  const payload: WorkspaceLastPlace = {
    ...place,
    at: new Date().toISOString(),
  }
  storage.setItem(LAST_PLACE_KEY, JSON.stringify(payload))
}

export function readWorkspaceLastPlace(
  storage: Storage,
): WorkspaceLastPlace | null {
  const raw = storage.getItem(LAST_PLACE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as WorkspaceLastPlace
    if (
      typeof parsed.path !== 'string' ||
      typeof parsed.label !== 'string' ||
      typeof parsed.kind !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Derive a human last-place record from the current pathname. */
export function lastPlaceFromPath(
  path: string,
): Omit<WorkspaceLastPlace, 'at'> | null {
  if (path === '/' || path.startsWith('/sign-')) return null
  if (path.startsWith('/invites/')) return null

  if (
    path === '/search' ||
    path.startsWith('/case/') ||
    path.startsWith('/cases/')
  ) {
    if (path.startsWith('/case/') || path.startsWith('/cases/')) {
      return { path, label: 'Opened judgment', kind: 'search', detail: path }
    }
    return { path: '/search', label: 'Case law search', kind: 'search' }
  }
  if (path.startsWith('/matters/')) {
    const id = path.split('/')[2]
    return {
      path: id ? `/matters/${id}` : '/matters',
      label: 'Matter',
      kind: 'matter',
      detail: id,
    }
  }
  if (path === '/matters') {
    return { path, label: 'Matters', kind: 'matter' }
  }
  if (path.startsWith('/redact/')) {
    const id = path.split('/')[2]
    return {
      path: id ? `/redact/${id}` : '/redact',
      label: 'Redaction run',
      kind: 'redact',
      detail: id,
    }
  }
  if (path === '/redact') {
    return { path, label: 'Redact', kind: 'redact' }
  }
  if (path === '/verify' || path.startsWith('/verify/')) {
    return { path: '/verify', label: 'Verify', kind: 'verify' }
  }
  return { path, label: 'Workspace', kind: 'other' }
}
