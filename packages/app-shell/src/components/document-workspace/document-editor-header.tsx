import {
  Button,
  StatusDot,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@obiter/ui'
import type { ReactNode } from 'react'
import type { DocumentPresence } from '@obiter/contracts'
import type { DocumentVersionRecord } from '../../documents'
import {
  DocumentVerifyChip,
  VerifyRunButton,
  VerifyRunReason,
} from './document-verify-chip'
import { useOffline } from '../../shell-states'
import type { DocumentSave, SaveState } from './use-document-save'
import { FloppyDisk } from '@phosphor-icons/react'

export type HeaderSaveInput = {
  state: SaveState
  versionLabel: string
  offline: boolean
  remoteChange: boolean
}

type HeaderSave = {
  label: string
  /** `null` draws no dot: an ongoing state has nothing to confirm. */
  tone: 'success' | 'warning' | 'danger' | null
}

/**
 * The one save-state sentence the editor header shows, derived from the save
 * machine rather than stored. Every state the workspace can reach is named,
 * including the two it can reach on its own — no network, and a newer version
 * on the server — so the header never reads "Saved" while work is unaccounted
 * for. `versionLabel` is the version the text on screen was last saved as.
 */
export function headerSaveState({
  state,
  versionLabel,
  offline,
  remoteChange,
}: HeaderSaveInput): HeaderSave {
  if (offline && state.status !== 'saved') {
    return { label: 'Offline · changes not saved', tone: 'warning' }
  }
  switch (state.status) {
    case 'saved':
      return { label: `Saved · ${versionLabel}`, tone: 'success' }
    case 'unsaved':
      return remoteChange
        ? { label: 'Newer version on the server', tone: 'warning' }
        : { label: `Unsaved changes · ${versionLabel}`, tone: 'warning' }
    case 'saving':
      return { label: 'Saving…', tone: null }
    case 'failed':
      // One line: the header has room for a status, not a sentence, and a
      // wrapped label read as a stray separator at the start of line two.
      return { label: 'Save failed — not on the server', tone: 'danger' }
    case 'stale':
      // The banner below the chrome already says this once, with Reload; the
      // header only stops claiming the work is saved.
      return { label: '', tone: null }
    case 'blocked':
      return {
        label: 'Saved, but the edit history needs a reload',
        tone: 'warning',
      }
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

/**
 * The editor's own header: what this document is, where it sits, whether the
 * work on screen is on the server, what is being checked, and the panel and
 * action controls. The back and matter links arrive as nodes because only the
 * route knows the router.
 */
function DocumentEditorHeader({
  filename,
  versionLabel,
  save,
  presence,
  currentUserId,
  trackChanges,
  onToggleTrackChanges,
  verify,
  saveButton,
  infoOpen,
  onToggleInfo,
  back,
  matterLink,
  actions,
}: {
  filename: string
  versionLabel: string
  save?: HeaderSaveInput
  presence?: DocumentPresence[]
  currentUserId?: string
  trackChanges?: boolean
  onToggleTrackChanges?: () => void
  verify?: ReactNode
  saveButton?: ReactNode
  infoOpen?: boolean
  /** Absent where the route did not load the document detail to show. */
  onToggleInfo?: () => void
  back?: ReactNode
  matterLink?: ReactNode
  actions?: ReactNode
}) {
  const headline = save ? headerSaveState(save) : null
  const others = (presence ?? []).filter(
    (item) => item.userId !== currentUserId,
  )
  return (
    <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-3 border-b border-line px-12 py-2 max-compact:px-8">
      {back}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-item text-ink" title={filename}>
          {filename}
        </h1>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-caption text-subtle">
          <span
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
            data-save-state={save?.state.status}
          >
            {headline === null ? (
              <span>{versionLabel}</span>
            ) : headline.tone === null ? (
              <span>{headline.label}</span>
            ) : (
              <StatusDot
                tone={headline.tone}
                className="text-caption whitespace-nowrap"
              >
                {headline.label}
              </StatusDot>
            )}
          </span>
          {/* The top bar's breadcrumb already names the matter at compact
              widths, so the header keeps one sub-line there. */}
          {matterLink ? (
            <span className="flex min-w-0 items-center gap-2 max-compact:hidden">
              <span aria-hidden>·</span>
              {matterLink}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {others.length > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="inline-flex"
                  aria-label={`${String(others.length)} other ${others.length === 1 ? 'person is' : 'people are'} viewing this document`}
                />
              }
            >
              <StatusDot tone="info" className="text-caption">
                {others.length === 1
                  ? '1 other viewer'
                  : `${String(others.length)} other viewers`}
              </StatusDot>
            </TooltipTrigger>
            <TooltipContent>
              Someone else has this document open. Saving merges disjoint edits;
              overlapping edits ask you to reload first.
            </TooltipContent>
          </Tooltip>
        ) : null}
        {trackChanges === undefined || !onToggleTrackChanges ? null : (
          // The switch, not a toggle button: the visible pill carries the
          // state and the control is a real checkbox with switch semantics,
          // so assistive technology reads on/off rather than a pressed button.
          <label
            className={cn(
              'inline-flex cursor-pointer items-center gap-2 rounded-pill px-2 py-1 text-caption select-none',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              'pointer-coarse:min-h-11',
              trackChanges
                ? 'bg-brand-soft text-ink'
                : 'text-muted hover:bg-hover hover:text-ink',
            )}
          >
            <input
              type="checkbox"
              role="switch"
              aria-label="Track changes"
              checked={trackChanges}
              onChange={onToggleTrackChanges}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={cn(
                'relative h-4 w-7 shrink-0 rounded-pill transition-colors duration-150',
                trackChanges ? 'bg-brand' : 'bg-line-strong',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 size-3 rounded-pill bg-surface-raised transition-[left] duration-150',
                  trackChanges ? 'left-3.5' : 'left-0.5',
                )}
              />
            </span>
            <span>
              {trackChanges ? 'Track changes on' : 'Track changes off'}
            </span>
          </label>
        )}
        {verify}
        {saveButton}
        {onToggleInfo ? (
          <Button
            variant={infoOpen ? 'secondary' : 'ghost'}
            size="sm"
            className="size-7 px-0"
            aria-label="Document information"
            aria-pressed={infoOpen}
            aria-expanded={infoOpen}
            onClick={onToggleInfo}
          >
            ?
          </Button>
        ) : null}
        {actions}
      </div>
    </header>
  )
}

/**
 * The DOCX editor's header: the save machine and the panel state wired to the
 * presentational header above. Kept here so `docx-workspace.tsx` stays within
 * its source ceiling and the save-state wording has one home.
 */
export function DocxEditorHeader({
  filename,
  versionNumber,
  save,
  remoteChange,
  presence,
  currentUserId,
  trackChanges,
  onToggleTrackChanges,
  versions,
  onOpenVerify,
  infoOpen,
  onToggleInfo,
  back,
  matterLink,
  actions,
}: {
  filename: string
  versionNumber?: number
  save: DocumentSave
  remoteChange: boolean
  presence: DocumentPresence[]
  currentUserId?: string
  trackChanges: boolean
  onToggleTrackChanges: () => void
  versions: DocumentVersionRecord[]
  onOpenVerify: () => void
  infoOpen: boolean
  onToggleInfo?: () => void
  back?: ReactNode
  matterLink?: ReactNode
  actions?: ReactNode
}) {
  const offline = useOffline()
  const versionLabel = `version ${String(versionNumber ?? 1)}`
  return (
    <DocumentEditorHeader
      filename={filename}
      versionLabel={versionLabel}
      save={{
        state: save.saveState,
        versionLabel,
        offline,
        remoteChange,
      }}
      presence={presence}
      currentUserId={currentUserId}
      trackChanges={trackChanges}
      onToggleTrackChanges={onToggleTrackChanges}
      verify={
        <>
          <DocumentVerifyChip versions={versions} onOpen={onOpenVerify} />
          <VerifyRunReason />
          <VerifyRunButton onOpen={onOpenVerify} />
        </>
      }
      saveButton={
        // preventDefault keeps the caret in the editor while the save flight
        // runs, so keystrokes typed during it still land. Keyboard activation
        // instead leaves focus here; the save path hands it back before
        // `saving` disables the control and the browser drops focus to body.
        <span onMouseDown={(event) => event.preventDefault()}>
          <Button
            size="sm"
            aria-label="Save"
            disabled={
              !save.dirty || save.saving || save.saveState.status === 'blocked'
            }
            loading={save.saving}
            onClick={save.save}
            iconStart={<FloppyDisk size={16} aria-hidden />}
          >
            <span className="max-compact:sr-only">Save</span>
          </Button>
        </span>
      }
      infoOpen={infoOpen}
      onToggleInfo={onToggleInfo}
      back={back}
      matterLink={matterLink}
      actions={actions}
    />
  )
}
