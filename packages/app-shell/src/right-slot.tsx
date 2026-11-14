import {
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@obiter/ui'
import { ChatText, Clock, Robot, ShieldCheck } from '@obiter/ui/icons'
import { Suspense, lazy, type ComponentType, type ReactNode } from 'react'
import { documentIdFromPath } from './navigation'
import { RightSlotOutlet } from './right-slot-portal'

export type RightSlotTabId = 'agent' | 'comments' | 'checks' | 'history'

type IconComponent = (props: {
  size?: number
  weight?: 'regular' | 'fill'
  className?: string
  'aria-hidden'?: boolean
}) => ReactNode

export interface RightSlotTab {
  id: RightSlotTabId
  label: string
  icon: IconComponent
  appliesTo: (pathname: string) => boolean
  content: ComponentType
}

const AgentTab = lazy(() =>
  import('./agent-panel').then((module) => ({ default: module.AgentTab })),
)

function onDocument(pathname: string) {
  return documentIdFromPath(pathname) !== null
}

const RIGHT_SLOT_TABS: readonly RightSlotTab[] = [
  {
    id: 'agent',
    label: 'Agent',
    icon: Robot,
    appliesTo: () => true,
    content: AgentTab,
  },
  {
    id: 'comments',
    label: 'Comments',
    icon: ChatText,
    appliesTo: onDocument,
    content: () => <RightSlotOutlet tab="comments" />,
  },
  {
    id: 'checks',
    label: 'Checks',
    icon: ShieldCheck,
    appliesTo: onDocument,
    content: () => <RightSlotOutlet tab="checks" />,
  },
  {
    id: 'history',
    label: 'History',
    icon: Clock,
    appliesTo: onDocument,
    content: () => <RightSlotOutlet tab="history" />,
  },
]

export function availableRightSlotTabs(pathname: string): RightSlotTab[] {
  return RIGHT_SLOT_TABS.filter((tab) => tab.appliesTo(pathname))
}

export function RightSlot({
  pathname,
  tab,
  onTabChange,
}: {
  pathname: string
  tab: RightSlotTabId
  onTabChange: (tab: RightSlotTabId) => void
}) {
  const tabs = availableRightSlotTabs(pathname)
  const active = tabs.find((item) => item.id === tab) ?? tabs[0]
  if (!active) return null
  const Content = active.content

  return (
    <aside
      aria-label={`${active.label} panel`}
      className={cn(
        'flex w-[330px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface',
        'max-md:fixed max-md:inset-x-0 max-md:bottom-12 max-md:z-40 max-md:max-h-[calc(70dvh-3rem)] max-md:w-auto max-md:rounded-b-none max-md:shadow-lg',
      )}
    >
      <Tabs
        value={active.id}
        onValueChange={(value) => {
          const next = tabs.find((item) => item.id === value)
          if (next) onTabChange(next.id)
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          className={
            tabs.length === 1
              ? 'hidden'
              : 'flex h-10 shrink-0 items-center border-b border-line px-2'
          }
        >
          <TabsList
            aria-label="Panel tabs"
            className="w-full gap-1 bg-transparent p-0"
          >
            {tabs.map((item) =>
              item.id === active.id ? (
                <RightSlotTabTrigger key={item.id} tab={item} open />
              ) : (
                <Tooltip key={item.id}>
                  <TooltipTrigger
                    render={<RightSlotTabTrigger tab={item} open={false} />}
                  />
                  <TooltipContent side="bottom">{item.label}</TooltipContent>
                </Tooltip>
              ),
            )}
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Suspense fallback={null}>
            <Content />
          </Suspense>
        </div>
      </Tabs>
    </aside>
  )
}

function RightSlotTabTrigger({
  tab,
  open,
  ...props
}: {
  tab: RightSlotTab
  open: boolean
}) {
  return (
    <TabsTrigger
      {...props}
      value={tab.id}
      className={cn(
        'flex items-center justify-center gap-1.5 px-2',
        open ? 'min-w-0 flex-1' : 'w-8 shrink-0',
      )}
    >
      <tab.icon size={14} className="shrink-0" aria-hidden />
      <span className={open ? 'truncate' : 'sr-only'}>{tab.label}</span>
    </TabsTrigger>
  )
}
