import { StatusDot, Tooltip, TooltipContent, TooltipTrigger } from '@obiter/ui'
import type { ReactNode } from 'react'
import type { DocumentPresence } from '@obiter/contracts'
import type { DocumentVersionRecord } from '../../documents'
import { useOffline } from '../../shell-states'
import { RedactedMark } from '../../redacted-mark'
import { PresenceAvatars } from './presence-avatars'
import type { DocumentSave, SaveState } from './use-document-save'

export type HeaderSaveInput = {
  state: SaveState
  versionLabel: string
  offline: boolean
  remoteChange: boolean
}

export type HeaderState = {
  label: string
  tone: 'success' | 'warning' | 'danger' | null
  detail: string
  status?: SaveState['status']
}

export function headerSaveState({
  state,
  versionLabel,
  offline,
  remoteChange,
}: HeaderSaveInput): HeaderState {
  if (offline && state.status !== 'saved') {
    return {
      label: 'Offline · changes not saved',
      tone: 'warning',
      detail: `The work on screen is held on this device until the connection returns. ${versionLabel} is the last saved version.`,
      status: state.status,
    }
  }
  switch (state.status) {
    case 'saved':
      return {
        label: 'Saved',
        tone: 'success',
        detail: `Saved as ${versionLabel}.`,
        status: state.status,
      }
    case 'unsaved':
      return remoteChange
        ? {
            label: 'Newer version on the server',
            tone: 'warning',
            detail:
              'A colleague saved a newer version. Reload before saving, or save to merge disjoint edits.',
            status: state.status,
          }
        : {
            label: 'Unsaved changes',
            tone: 'warning',
            detail: `The work on screen is not in ${versionLabel} yet.`,
            status: state.status,
          }
    case 'saving':
      return {
        label: 'Saving…',
        tone: null,
        detail: `Saving the work on screen. ${versionLabel} is the last saved version.`,
        status: state.status,
      }
    case 'failed':
      return {
        label: 'Save failed',
        tone: 'danger',
        detail: `The work on screen is not on the server. ${versionLabel} is the last saved version.`,
        status: state.status,
      }
    case 'stale':
      return { label: '', tone: null, detail: '', status: state.status }
    case 'blocked':
      return {
        label: 'Saved, history needs a reload',
        tone: 'warning',
        detail: `The work is saved as ${versionLabel}, but the edit history must be reloaded before the next save.`,
        status: state.status,
      }
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

export function readOnlyHeaderState(versionLabel: string): HeaderState {
  return {
    label: 'Read only',
    tone: null,
    detail: `This view is not editable. It shows ${versionLabel}.`,
  }
}

export function DocumentEditorHeader({
  filename,
  mark,
  state,
  presence,
  presenceNames,
  currentUserId,
  actions,
}: {
  filename: string
  mark?: ReactNode
  state?: HeaderState
  presence?: DocumentPresence[]
  presenceNames?: ReadonlyMap<string, string>
  currentUserId?: string
  actions?: ReactNode
}) {
  return (
    <header className="flex h-9 min-w-0 shrink-0 items-center gap-2 border-b border-line px-3">
      <h1 className="min-w-0 truncate text-item text-ink" title={filename}>
        {filename}
      </h1>
      {mark}
      <div className="ms-auto flex min-w-0 shrink-0 items-center gap-2">
        <PresenceAvatars
          presence={presence ?? []}
          currentUserId={currentUserId}
          names={presenceNames}
        />
        {state ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="inline-flex items-center whitespace-nowrap text-caption text-subtle"
                  data-save-state={state.status}
                />
              }
            >
              {state.tone === null ? (
                <span>{state.label}</span>
              ) : (
                <StatusDot tone={state.tone} className="text-caption">
                  {state.label}
                </StatusDot>
              )}
            </TooltipTrigger>
            <TooltipContent>{state.detail}</TooltipContent>
          </Tooltip>
        ) : null}
        {actions}
      </div>
    </header>
  )
}

export function DocxEditorHeader({
  filename,
  versionNumber,
  save,
  remoteChange,
  presence,
  presenceNames,
  currentUserId,
  versions,
  actions,
}: {
  filename: string
  versionNumber?: number
  save: DocumentSave
  remoteChange: boolean
  presence: DocumentPresence[]
  presenceNames?: ReadonlyMap<string, string>
  currentUserId?: string
  versions: DocumentVersionRecord[]
  actions?: ReactNode
}) {
  const offline = useOffline()
  const versionLabel = `version ${String(versionNumber ?? 1)}`
  const current = versions.find(
    (version) => version.versionNumber === versionNumber,
  )
  return (
    <DocumentEditorHeader
      filename={filename}
      mark={
        current?.redaction ? (
          <RedactedMark
            redaction={current.redaction}
            producedAt={current.createdAt}
          />
        ) : null
      }
      state={headerSaveState({
        state: save.saveState,
        versionLabel,
        offline,
        remoteChange,
      })}
      presence={presence}
      presenceNames={presenceNames}
      currentUserId={currentUserId}
      actions={actions}
    />
  )
}
