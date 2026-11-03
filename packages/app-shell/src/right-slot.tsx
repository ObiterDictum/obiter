import { Tabs, TabsList, TabsTrigger, cn } from '@obiter/ui'
import { ChatText, Clock, Robot, ShieldCheck } from '@obiter/ui/icons'
import { Suspense, lazy, type ComponentType, type ReactNode } from 'react'
import type { ShellSection } from './navigation'

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
  sections: readonly ShellSection[]
  content: ComponentType | null
}

const AgentTab = lazy(() =>
  import('./agent-panel').then((module) => ({ default: module.AgentTab })),
)

const EVERY_SECTION: readonly ShellSection[] = [
  'home',
  'matters',
  'search',
  'verify',
  'redact',
  'settings',
  'other',
]

const RIGHT_SLOT_TABS: readonly RightSlotTab[] = [
  {
    id: 'agent',
    label: 'Agent',
    icon: Robot,
    sections: EVERY_SECTION,
    content: AgentTab,
  },
  {
    id: 'comments',
    label: 'Comments',
    icon: ChatText,
    sections: [],
    content: null,
  },
  {
    id: 'checks',
    label: 'Checks',
    icon: ShieldCheck,
    sections: [],
    content: null,
  },
  {
    id: 'history',
    label: 'History',
    icon: Clock,
    sections: [],
    content: null,
  },
]

function availableRightSlotTabs(section: ShellSection): RightSlotTab[] {
  return RIGHT_SLOT_TABS.filter(
    (tab) => tab.content !== null && tab.sections.includes(section),
  )
}

export function RightSlot({
  section,
  tab,
  onTabChange,
}: {
  section: ShellSection
  tab: RightSlotTabId
  onTabChange: (tab: RightSlotTabId) => void
}) {
  const tabs = availableRightSlotTabs(section)
  const active = tabs.find((item) => item.id === tab) ?? tabs[0]
  if (!active || !active.content) return null
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
        <div className="flex h-10 shrink-0 items-center border-b border-line px-2">
          <TabsList aria-label="Panel tabs" className="bg-transparent p-0">
            {tabs.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="flex items-center gap-1.5"
              >
                <item.icon size={14} aria-hidden />
                {item.label}
              </TabsTrigger>
            ))}
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
