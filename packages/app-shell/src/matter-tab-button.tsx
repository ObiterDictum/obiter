import type { AppPlatform } from '@obiter/contracts'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  KeyboardHint,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@obiter/ui'
import { FileText, House, PencilSimple, ShieldCheck, X } from '@obiter/ui/icons'
import { useCallback, type ReactNode } from 'react'
import { DocumentTabSaveIndicator } from './document-tab-save-indicator'
import type { DocumentTabStatus } from './document-tab-status'
import { formatShortcut, useIsMacPlatform } from './keyboard-platform'
import type { MatterTab, MatterTabKind } from './matter-tabs'
import { useMatterTabs } from './matter-tabs-state'

interface TabIconProps {
  size?: number
  weight?: 'regular' | 'fill'
  className?: string
  'aria-hidden'?: boolean
}

const TAB_ICONS = {
  overview: House,
  document: FileText,
  verify: ShieldCheck,
  redact: PencilSimple,
} satisfies Record<MatterTabKind, (props: TabIconProps) => ReactNode>

export function TabIcon({
  kind,
  size = 13,
}: {
  kind: MatterTabKind
  size?: number
}) {
  const Icon = TAB_ICONS[kind]
  return <Icon size={size} aria-hidden className="shrink-0 text-subtle" />
}

export function tabAccessibleName(
  tab: MatterTab,
  status: DocumentTabStatus | null,
): string {
  const save = status?.save
  if (!save || save.indicator === 'none' || save.label === '') return tab.title
  return `${tab.title}, ${save.label}`
}

export function MatterTabButton({
  tab,
  active,
  platform,
  status,
  onTabDrag,
  onDelete,
}: {
  tab: MatterTab
  active: boolean
  platform: AppPlatform
  status: DocumentTabStatus | null
  onTabDrag: (id: string | null) => void
  onDelete?: () => void
}) {
  const { close, goToTab, openToSide, promote } = useMatterTabs()
  const iconOnly = tab.kind === 'overview'
  const labelButton = (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={tabAccessibleName(tab, status)}
      onClick={() => goToTab(tab)}
      onDoubleClick={() => promote(tab.id)}
      className={cn(
        'flex min-w-0 items-center gap-2 py-1.5 text-meta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        iconOnly ? 'px-2' : 'pr-1 pl-2.5',
      )}
    >
      <TabIcon kind={tab.kind} />
      {iconOnly ? null : (
        <span className={cn('max-w-[11rem] truncate', tab.preview && 'italic')}>
          {tab.title}
        </span>
      )}
    </button>
  )
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
            {iconOnly ? (
              <Tooltip>
                <TooltipTrigger render={labelButton} />
                <TooltipContent side="bottom">{tab.title}</TooltipContent>
              </Tooltip>
            ) : (
              labelButton
            )}
            <DocumentTabSaveIndicator state={status?.save ?? null} />
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
        {onDelete ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onDelete} className="text-danger">
              Delete document
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function CloseShortcutHint() {
  const isMac = useIsMacPlatform()
  return <KeyboardHint>{formatShortcut(['primary', 'W'], isMac)}</KeyboardHint>
}
