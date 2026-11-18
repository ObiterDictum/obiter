import { Link } from '@tanstack/react-router'
import { PopoverPopup, PopoverPositioner, cn } from '@obiter/ui'
import { GearSix, ShieldCheck } from '@obiter/ui/icons'
import type { MeResponse } from '@obiter/contracts'
import { MODULES, type ShellSection } from './navigation'
import { MatterRow, ModuleRow } from './sidebar-rows'
import { moduleTone, type useSidebarData } from './sidebar-counts'
import { ThemeToggle } from './theme-toggle'

export default function ShellMenuPopup({
  me,
  section,
  currentMatterId,
  sidebarData: { counts, verifyTone, recent },
  onClose,
  onSignOut,
}: {
  me: MeResponse | undefined
  section: ShellSection
  currentMatterId: string | null
  sidebarData: ReturnType<typeof useSidebarData>
  onClose: () => void
  onSignOut: () => void
}) {
  return (
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
              onClick={onClose}
            />
          ))}
          {me?.isStaff ? (
            <ModuleRow
              label="Staff"
              to="/staff"
              icon={ShieldCheck}
              current={section === 'staff'}
              onClick={onClose}
            />
          ) : null}
        </nav>

        {recent.length > 0 ? (
          <div>
            <p className="px-2 pb-1 text-caption text-muted">Recent matters</p>
            <ul className="flex flex-col gap-px">
              {recent.map((matter) => (
                <li key={matter.id}>
                  <MatterRow
                    matter={matter}
                    current={matter.id === currentMatterId}
                    onClick={onClose}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center gap-1 border-t border-line px-0.5 pt-1.5">
          <Link
            to="/settings"
            onClick={onClose}
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
            onClick={onSignOut}
            className="shrink-0 rounded-md px-2 py-1 text-caption text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Sign out
          </button>
        </div>
      </PopoverPopup>
    </PopoverPositioner>
  )
}
