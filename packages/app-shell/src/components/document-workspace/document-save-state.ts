import type { SaveState } from './use-document-save'

export type SaveIndicator = 'none' | 'dot' | 'saving' | 'warning' | 'danger'

export type SaveStateInput = {
  status: SaveState['status']
  versionLabel: string
  offline: boolean
  remoteChange: boolean
}

export type SaveStateLabel = {
  label: string
  detail: string
  indicator: SaveIndicator
  status: SaveState['status']
}

export function tabSaveState({
  status,
  versionLabel,
  offline,
  remoteChange,
}: SaveStateInput): SaveStateLabel {
  if (offline && status !== 'saved') {
    return {
      label: 'Offline · changes not saved',
      indicator: 'danger',
      detail: `The work on screen is held on this device until the connection returns. ${versionLabel} is the last saved version.`,
      status,
    }
  }
  switch (status) {
    case 'saved':
      return {
        label: 'Saved',
        indicator: 'none',
        detail: `Saved as ${versionLabel}.`,
        status,
      }
    case 'unsaved':
      return remoteChange
        ? {
            label: 'Newer version on the server',
            indicator: 'danger',
            detail:
              'A colleague saved a newer version. Reload before saving, or save to merge disjoint edits.',
            status,
          }
        : {
            label: 'Unsaved changes',
            indicator: 'dot',
            detail: `The work on screen is not in ${versionLabel} yet.`,
            status,
          }
    case 'saving':
      return {
        label: 'Saving…',
        indicator: 'saving',
        detail: `Saving the work on screen. ${versionLabel} is the last saved version.`,
        status,
      }
    case 'failed':
      return {
        label: 'Save failed',
        indicator: 'danger',
        detail: `The work on screen is not on the server. ${versionLabel} is the last saved version.`,
        status,
      }
    case 'stale':
      return { label: '', detail: '', indicator: 'none', status }
    case 'blocked':
      return {
        label: 'Saved, history needs a reload',
        indicator: 'warning',
        detail: `The work is saved as ${versionLabel}, but the edit history must be reloaded before the next save.`,
        status,
      }
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}

export function readOnlySaveState(versionLabel: string) {
  return {
    label: 'Read only',
    detail: `This view is not editable. It shows ${versionLabel}.`,
  }
}
