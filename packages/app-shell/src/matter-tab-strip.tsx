import type { AppPlatform } from '@obiter/contracts'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  cn,
} from '@obiter/ui'
import { DotsThree, SidebarSimple, Trash, X } from '@obiter/ui/icons'
import { useEffect, useState } from 'react'
import {
  DeleteDocumentDialog,
  useCanManageDocuments,
} from './matter-tab-actions'
import {
  MatterTabButton,
  TabIcon,
  tabAccessibleName,
} from './matter-tab-button'
import { SaveStateMark } from './document-tab-save-indicator'
import {
  useDocumentTabStatuses,
  type DocumentTabStatus,
} from './document-tab-status'
import { useMatterDocuments } from './documents'
import { PresenceAvatars } from './components/document-workspace/presence-avatars'
import { matchMatterTabKey, type MatterTab } from './matter-tabs'
import { useMatterTabs } from './matter-tabs-state'
import { useMatter } from './matters'
import { MatterNewItemMenu } from './matter-tab-new-menu'
import { useRedactionRunsList } from './redaction-runs'

const stripButtonClass =
  'grid size-7 shrink-0 self-center place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40'

type Statuses = Readonly<Record<string, DocumentTabStatus>>

export function MatterTabStrip({
  platform,
  compact,
  onTabDrag,
}: {
  platform: AppPlatform
  compact: boolean
  onTabDrag: (id: string | null) => void
}) {
  const { tabs, activeId, matterId, close } = useMatterTabs()
  const named = useResolvedTabs(tabs)
  useMatterTabShortcuts(platform, named)
  const statuses = useDocumentTabStatuses()
  const canManage = useCanManageDocuments()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const activeTab = named.find((tab) => tab.id === activeId) ?? null
  const activeDocumentId =
    activeTab?.kind === 'document' ? activeTab.target : null
  const activeStatus = statusFor(activeTab, statuses)
  const documentActions =
    canManage && activeDocumentId
      ? () => setDeletingId(activeDocumentId)
      : undefined
  return (
    <div className="flex h-10 shrink-0 items-stretch gap-1 border-b border-line bg-surface px-2">
      {compact ? (
        <CompactTabs
          tabs={named}
          activeId={activeId}
          statuses={statuses}
          documentActions={documentActions}
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-stretch gap-0.5">
          <div
            role="group"
            aria-label="Open in this matter"
            className="flex min-w-0 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]"
          >
            {named.map((tab) => (
              <MatterTabButton
                key={tab.id}
                tab={tab}
                platform={platform}
                active={tab.id === activeId}
                status={statusFor(tab, statuses)}
                onTabDrag={onTabDrag}
                onDelete={
                  canManage && tab.kind === 'document' && tab.target
                    ? () => setDeletingId(tab.target)
                    : undefined
                }
              />
            ))}
          </div>
          <MatterNewItemMenu />
        </div>
      )}
      {compact ? <MatterNewItemMenu /> : null}
      {activeStatus ? (
        <span className="flex shrink-0 items-center self-center">
          <PresenceAvatars
            presence={activeStatus.participants}
            currentUserId={activeStatus.currentUserId}
            names={activeStatus.presenceNames}
          />
        </span>
      ) : null}
      {compact ? null : (
        <OverflowMenu
          tabs={named}
          activeId={activeId}
          statuses={statuses}
          documentActions={documentActions}
        />
      )}
      <SplitControls />
      {deletingId ? (
        <DeleteDocumentDialog
          documentId={deletingId}
          matterId={matterId}
          onClose={() => setDeletingId(null)}
          onDeleted={() => {
            close(`document:${deletingId}`)
            setDeletingId(null)
          }}
        />
      ) : null}
    </div>
  )
}

function statusFor(
  tab: MatterTab | null,
  statuses: Statuses,
): DocumentTabStatus | null {
  if (!tab || tab.kind !== 'document' || !tab.target) return null
  return statuses[tab.target] ?? null
}

function useMatterTabShortcuts(platform: AppPlatform, tabs: MatterTab[]) {
  const { activeId, close, reopenLastClosed, goToTab } = useMatterTabs()
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const command = matchMatterTabKey(event, {
        platform,
        tabCount: tabs.length,
      })
      if (!command) return
      event.preventDefault()
      if (command.kind === 'select') {
        const tab = tabs[command.index]
        if (tab) goToTab(tab)
        return
      }
      if (command.kind === 'close') {
        if (activeId) close(activeId)
        return
      }
      reopenLastClosed()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
}

function useResolvedTabs(tabs: MatterTab[]): MatterTab[] {
  const { matterId } = useMatterTabs()
  const documents = useMatterDocuments(matterId).data ?? []
  const runs = useRedactionRunsList().data?.runs ?? []
  const matter = useMatter(matterId).data
  return tabs.map((tab) => ({
    ...tab,
    title: liveTitle(tab, matter?.name ?? null, documents, runs),
  }))
}

function liveTitle(
  tab: MatterTab,
  matterName: string | null,
  documents: Array<{
    id: string
    currentVersion?: { filename: string } | null
  }>,
  runs: Array<{ id: string; sourceFilename: string }>,
): string {
  if (tab.kind === 'overview') return matterName ?? tab.title
  if (tab.kind === 'document') {
    return (
      documents.find((item) => item.id === tab.target)?.currentVersion
        ?.filename ?? tab.title
    )
  }
  if (tab.kind === 'redact') {
    return (
      runs.find((item) => item.id === tab.target)?.sourceFilename ?? tab.title
    )
  }
  return tab.title
}

function TabMenuActions({ documentActions }: { documentActions?: () => void }) {
  if (!documentActions) return null
  return (
    <>
      <MenuSeparator />
      <MenuItem onClick={documentActions} className="text-danger">
        <Trash size={14} aria-hidden />
        Delete document
      </MenuItem>
    </>
  )
}

function OverflowMenu({
  tabs,
  activeId,
  statuses,
  documentActions,
}: {
  tabs: MatterTab[]
  activeId: string | null
  statuses: Statuses
  documentActions?: () => void
}) {
  const { goToTab } = useMatterTabs()
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="All open tabs"
            className={stripButtonClass}
          >
            <DotsThree size={16} aria-hidden />
          </button>
        }
      />
      <MenuContent aria-label="All open tabs">
        {tabs.map((tab) => (
          <MenuItem
            key={tab.id}
            onClick={() => goToTab(tab)}
            className={cn('gap-2', tab.id === activeId && 'text-ink')}
          >
            <TabIcon kind={tab.kind} size={14} />
            <span
              className={cn('min-w-0 flex-1 truncate', tab.preview && 'italic')}
            >
              {tab.title}
            </span>
            <SaveStateMark state={statusFor(tab, statuses)?.save ?? null} />
            {tab.id === activeId ? (
              <span className="text-caption text-subtle">Open</span>
            ) : null}
          </MenuItem>
        ))}
        <TabMenuActions documentActions={documentActions} />
      </MenuContent>
    </Menu>
  )
}

function CompactTabs({
  tabs,
  activeId,
  statuses,
  documentActions,
}: {
  tabs: MatterTab[]
  activeId: string | null
  statuses: Statuses
  documentActions?: () => void
}) {
  const { goToTab } = useMatterTabs()
  const active = tabs.find((tab) => tab.id === activeId) ?? null
  const activeStatus = statusFor(active, statuses)
  return (
    <div className="flex min-w-0 flex-1 items-center">
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={`${String(tabs.length)} open, ${active ? tabAccessibleName(active, activeStatus) : 'show tabs'}`}
              className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 text-meta text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="shrink-0 tabular-nums">{tabs.length} open</span>
              {active ? (
                <span className="min-w-0 truncate text-subtle">
                  {active.title}
                </span>
              ) : null}
              <SaveStateMark state={activeStatus?.save ?? null} />
            </button>
          }
        />
        <MenuContent aria-label="All open tabs">
          {tabs.map((tab) => (
            <MenuItem
              key={tab.id}
              onClick={() => goToTab(tab)}
              className="gap-2"
            >
              <TabIcon kind={tab.kind} size={14} />
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              <SaveStateMark state={statusFor(tab, statuses)?.save ?? null} />
            </MenuItem>
          ))}
          <TabMenuActions documentActions={documentActions} />
        </MenuContent>
      </Menu>
    </div>
  )
}

function SplitControls() {
  const { tabs, activeId, sideId, openToSide, closeSide } = useMatterTabs()
  const beside = [...tabs]
    .reverse()
    .find((tab) => tab.kind === 'document' && tab.id !== activeId)
  if (sideId) {
    return (
      <button
        type="button"
        aria-label="Close split view"
        onClick={closeSide}
        className={stripButtonClass}
      >
        <X size={16} aria-hidden />
      </button>
    )
  }
  return (
    <button
      type="button"
      aria-label="Open a document to the side"
      disabled={!beside}
      onClick={() => {
        if (beside) openToSide(beside.id)
      }}
      className={stripButtonClass}
    >
      <SidebarSimple size={16} aria-hidden className="rotate-180" />
    </button>
  )
}
