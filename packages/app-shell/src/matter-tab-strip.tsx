import type { AppPlatform } from '@obiter/contracts'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  KeyboardHint,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@obiter/ui'
import {
  DotsThree,
  FileText,
  Folders,
  PencilSimple,
  ShieldCheck,
  SidebarSimple,
  X,
} from '@obiter/ui/icons'
import { Suspense, lazy, useCallback, useEffect, type ReactNode } from 'react'
import { formatShortcut, useIsMacPlatform } from './keyboard-platform'
import type { AppPlatform as Platform } from '@obiter/contracts'
import { useMatterDocuments } from './documents'
import {
  matchMatterTabKey,
  type MatterTab,
  type MatterTabKind,
} from './matter-tabs'
import { useMatterTabs } from './matter-tabs-state'
import { useMatter } from './matters'
import { useRedactionRunsList } from './redaction-runs'
const MatterNewItemMenu = lazy(() =>
  import('./matter-tab-new-menu').then((module) => ({
    default: module.MatterNewItemMenu,
  })),
)

interface TabIconProps {
  size?: number
  weight?: 'regular' | 'fill'
  className?: string
  'aria-hidden'?: boolean
}

const TAB_ICONS = {
  overview: Folders,
  document: FileText,
  verify: ShieldCheck,
  redact: PencilSimple,
} satisfies Record<MatterTabKind, (props: TabIconProps) => ReactNode>

const stripButtonClass =
  'grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40'

export function MatterTabStrip({
  platform,
  compact,
  onTabDrag,
}: {
  platform: AppPlatform
  compact: boolean
  onTabDrag: (id: string | null) => void
}) {
  const { tabs, activeId } = useMatterTabs()
  const named = useResolvedTabs(tabs)
  useMatterTabShortcuts(platform, named)
  return (
    <div className="flex h-10 shrink-0 items-stretch gap-1 border-b border-line bg-surface px-2">
      {compact ? (
        <CompactTabs tabs={named} activeId={activeId} />
      ) : (
        <div
          role="group"
          aria-label="Open in this matter"
          className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]"
        >
          {named.map((tab) => (
            <MatterTabButton
              key={tab.id}
              tab={tab}
              platform={platform}
              active={tab.id === activeId}
              onTabDrag={onTabDrag}
            />
          ))}
          <Suspense fallback={null}>
            <MatterNewItemMenu />
          </Suspense>
        </div>
      )}
      {compact ? (
        <Suspense fallback={null}>
          <MatterNewItemMenu />
        </Suspense>
      ) : null}
      {compact ? null : <OverflowMenu tabs={named} activeId={activeId} />}
      <SplitControls />
    </div>
  )
}

function useMatterTabShortcuts(platform: Platform, tabs: MatterTab[]) {
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

function MatterTabButton({
  tab,
  active,
  platform,
  onTabDrag,
}: {
  tab: MatterTab
  active: boolean
  platform: AppPlatform
  onTabDrag: (id: string | null) => void
}) {
  const { close, goToTab, openToSide, promote } = useMatterTabs()
  const Icon = TAB_ICONS[tab.kind]
  const keepInView = useCallback(
    (node: HTMLDivElement | null) => {
      if (!active || !node || typeof node.scrollIntoView !== 'function') return
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    },
    [active],
  )
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            ref={keepInView}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', tab.id)
              onTabDrag(tab.id)
            }}
            onDragEnd={() => onTabDrag(null)}
            onAuxClick={(event) => {
              if (event.button !== 1) return
              event.preventDefault()
              close(tab.id)
            }}
            className={cn(
              'group -mb-px flex min-w-0 shrink-0 items-center rounded-t-lg border border-transparent',
              active
                ? 'border-line border-b-transparent bg-raised text-ink'
                : 'text-muted hover:bg-hover hover:text-ink',
            )}
          >
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => goToTab(tab)}
              onDoubleClick={() => promote(tab.id)}
              className="flex min-w-0 items-center gap-2 py-1.5 pr-1 pl-2.5 text-meta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Icon size={13} aria-hidden className="shrink-0 text-subtle" />
              <span
                className={cn(
                  'max-w-[11rem] truncate',
                  tab.preview && 'italic',
                )}
              >
                {tab.title}
              </span>
            </button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Close ${tab.title}`}
                    onClick={() => close(tab.id)}
                    className="mr-1 grid size-5 shrink-0 place-items-center rounded-sm text-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-fill hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  >
                    <X size={11} aria-hidden />
                  </button>
                }
              />
              <TooltipContent side="bottom">
                <span className="flex items-center gap-2">
                  Close tab
                  {platform === 'desktop' ? <CloseShortcutHint /> : null}
                </span>
              </TooltipContent>
            </Tooltip>
          </div>
        }
      />
      <ContextMenuContent aria-label={`${tab.title} tab actions`}>
        <ContextMenuItem
          disabled={tab.kind !== 'document'}
          onClick={() => openToSide(tab.id)}
        >
          Open to the side
        </ContextMenuItem>
        <ContextMenuItem onClick={() => close(tab.id)}>
          Close tab
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function CloseShortcutHint() {
  const isMac = useIsMacPlatform()
  return <KeyboardHint>{formatShortcut(['primary', 'W'], isMac)}</KeyboardHint>
}

function OverflowMenu({
  tabs,
  activeId,
}: {
  tabs: MatterTab[]
  activeId: string | null
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
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab.kind]
          return (
            <MenuItem
              key={tab.id}
              onClick={() => goToTab(tab)}
              className={cn('gap-2', tab.id === activeId && 'text-ink')}
            >
              <Icon size={14} aria-hidden className="shrink-0 text-subtle" />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  tab.preview && 'italic',
                )}
              >
                {tab.title}
              </span>
              {tab.id === activeId ? (
                <span className="text-caption text-subtle">Open</span>
              ) : null}
            </MenuItem>
          )
        })}
      </MenuContent>
    </Menu>
  )
}

function CompactTabs({
  tabs,
  activeId,
}: {
  tabs: MatterTab[]
  activeId: string | null
}) {
  const { goToTab } = useMatterTabs()
  const active = tabs.find((tab) => tab.id === activeId)
  return (
    <div className="flex min-w-0 flex-1 items-center">
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={`${String(tabs.length)} open, show tabs`}
              className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 text-meta text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="shrink-0 tabular-nums">{tabs.length} open</span>
              {active ? (
                <span className="min-w-0 truncate text-subtle">
                  {active.title}
                </span>
              ) : null}
            </button>
          }
        />
        <MenuContent aria-label="All open tabs">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab.kind]
            return (
              <MenuItem
                key={tab.id}
                onClick={() => goToTab(tab)}
                className="gap-2"
              >
                <Icon size={14} aria-hidden className="shrink-0 text-subtle" />
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              </MenuItem>
            )
          })}
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
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Close split view"
              onClick={closeSide}
              className={stripButtonClass}
            >
              <X size={16} aria-hidden />
            </button>
          }
        />
        <TooltipContent side="bottom">Close split view</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
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
        }
      />
      <TooltipContent side="bottom">
        Show a document beside this one
      </TooltipContent>
    </Tooltip>
  )
}
