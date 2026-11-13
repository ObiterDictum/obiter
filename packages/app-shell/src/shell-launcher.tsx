import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  ObiterMark,
  cn,
} from '@obiter/ui'
import { GearSix, ShieldCheck } from '@obiter/ui/icons'
import { Robot } from '@obiter/ui/icons/shell'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from './auth'
import { currentUserQueryOptions } from './current-user'
import { MODULES, matterIdFromPath, resolveSection } from './navigation'
import { countNote, countToneClass, MatterRow } from './sidebar-rows'
import { moduleTone, useSidebarData } from './sidebar-counts'
import { ThemeToggle } from './theme-toggle'

const iconButtonClass =
  'grid size-9 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label="Open Obiter menu"
            className={cn(
              iconButtonClass,
              'app-no-drag size-8 place-items-center',
            )}
          >
            <ObiterMark className="size-6" title="" />
          </button>
        }
      />
      <DialogContent className="inset-0 left-0 top-0 h-dvh w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0 shadow-none">
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-8 overflow-y-auto px-6 py-10">
          <DialogTitle className="text-page text-ink">Obiter</DialogTitle>

          <nav
            aria-label="Modules"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {MODULES.map((module) => {
              const count = counts.get(module.id)
              const note = countNote(module.label, count)
              const alertTone = moduleTone(module.id, verifyTone)
              const toneClass = countToneClass(module.label, alertTone)
              return (
                <Link
                  key={module.id}
                  to={module.to}
                  onClick={close}
                  aria-label={note ? `${module.label}, ${note}` : module.label}
                  aria-current={section === module.id ? 'page' : undefined}
                  className={cn(
                    'flex min-h-14 items-center gap-3 rounded-lg border border-line bg-surface px-4 text-item',
                    'transition-colors duration-150 hover:border-line-strong hover:bg-hover',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    section === module.id
                      ? 'font-medium text-ink'
                      : 'text-muted',
                  )}
                >
                  <module.icon size={20} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {module.label}
                  </span>
                  {alertTone === 'danger' && count ? (
                    <span
                      aria-hidden
                      className="size-1.5 rounded-pill bg-danger"
                    />
                  ) : null}
                  {count ? (
                    <span
                      aria-hidden
                      className={cn('text-meta tabular-nums', toneClass)}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </nav>

          <div>
            <button
              type="button"
              aria-label="Agent"
              aria-expanded={rightSlotOpen}
              aria-controls="app-shell-right-slot"
              onClick={() => {
                onToggleRightSlot()
                close()
              }}
              className={cn(
                'flex min-h-14 w-full items-center gap-3 rounded-lg border border-line bg-surface px-4 text-item',
                'transition-colors duration-150 hover:border-line-strong hover:bg-hover',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                rightSlotOpen ? 'font-medium text-ink' : 'text-muted',
              )}
            >
              <Robot size={20} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">Agent</span>
            </button>
          </div>

          {recent.length > 0 ? (
            <div>
              <p className="pb-1 text-caption text-muted">Recent matters</p>
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

          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-6">
            <Link
              to="/settings"
              onClick={close}
              aria-current={section === 'settings' ? 'page' : undefined}
              className="flex h-9 items-center gap-2 rounded-md px-2 text-meta text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <GearSix size={16} aria-hidden />
              Settings
            </Link>
            <ThemeToggle />
            {me?.isStaff ? (
              <Link
                to="/staff"
                onClick={close}
                aria-current={section === 'staff' ? 'page' : undefined}
                className={cn(
                  iconButtonClass,
                  section === 'staff' && 'text-ink',
                )}
                aria-label="Staff"
              >
                <ShieldCheck size={16} aria-hidden />
              </Link>
            ) : null}
            <span className="ml-auto flex items-center gap-3">
              <span className="max-w-[16rem] truncate text-meta text-muted">
                {me?.user.name}
              </span>
              <button
                type="button"
                onClick={signOutAndClose}
                className="rounded-md px-2 py-1 text-meta text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Sign out
              </button>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
