import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  ObiterMark,
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
  cn,
} from '@obiter/ui'
import { GearSix, ShieldCheck } from '@obiter/ui/icons'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from './auth'
import { currentUserQueryOptions } from './current-user'
import { MODULES, matterIdFromPath, resolveSection } from './navigation'
import { AgentRow, MatterRow, ModuleRow } from './sidebar-rows'
import { moduleTone, useSidebarData } from './sidebar-counts'
import { ThemeToggle } from './theme-toggle'

export function ShellMenuButton({
  rightSlotOpen,
  onToggleRightSlot,
}: {
  rightSlotOpen: boolean
  onToggleRightSlot: () => void
}) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { data: me } = useQuery(currentUserQueryOptions())
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { counts, verifyTone, recent } = useSidebarData()
  const section = resolveSection(pathname)
  const currentMatterId = matterIdFromPath(pathname)

  function close() {
    setOpen(false)
  }

  function signOutAndClose() {
    close()
    void signOut()
    void navigate({ to: '/sign-in' })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Open Obiter menu"
            className="app-no-drag grid size-8 shrink-0 place-items-center rounded-md transition-colors duration-150 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ObiterMark className="size-6" title="" />
          </button>
        }
      />
      <PopoverPortal>
        <PopoverPositioner side="bottom" align="start" sideOffset={6}>
          <PopoverPopup
            aria-label="Obiter menu"
            className="flex max-h-[calc(100dvh-var(--obiter-space-56))] w-64 flex-col gap-3 overflow-y-auto p-1.5"
          >
            <nav aria-label="Modules" className="flex flex-col gap-px">
              {MODULES.map((module) => (
                <ModuleRow
                  key={module.id}
                  label={module.label}
                  to={module.to}
                  icon={module.icon}
                  count={counts.get(module.id)}
                  alertTone={moduleTone(module.id, verifyTone)}
                  current={section === module.id}
                  onClick={close}
                />
              ))}
              <AgentRow
                expanded={rightSlotOpen}
                onClick={() => {
                  onToggleRightSlot()
                  close()
                }}
              />
              {me?.isStaff ? (
                <ModuleRow
                  label="Staff"
                  to="/staff"
                  icon={ShieldCheck}
                  current={section === 'staff'}
                  onClick={close}
                />
              ) : null}
            </nav>

            {recent.length > 0 ? (
              <div>
                <p className="px-2 pb-1 text-caption text-muted">
                  Recent matters
                </p>
                <ul className="flex flex-col gap-px">
                  {recent.map((matter) => (
                    <li key={matter.id}>
                      <MatterRow
                        matter={matter}
                        current={matter.id === currentMatterId}
                        onClick={close}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex items-center gap-1 border-t border-line px-0.5 pt-1.5">
              <Link
                to="/settings"
                onClick={close}
                aria-label="Settings"
                aria-current={section === 'settings' ? 'page' : undefined}
                className={cn(
                  'grid size-8 place-items-center rounded-md transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  section === 'settings' ? 'text-ink' : 'text-muted',
                )}
              >
                <GearSix size={16} aria-hidden />
              </Link>
              <ThemeToggle />
              <span className="ml-auto min-w-0 truncate text-caption text-muted">
                {me?.user.name}
              </span>
              <button
                type="button"
                onClick={signOutAndClose}
                className="shrink-0 rounded-md px-2 py-1 text-caption text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Sign out
              </button>
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  )
}
