import { useNavigate, useRouterState } from '@tanstack/react-router'
import { ObiterMark, Popover, PopoverPortal, PopoverTrigger } from '@obiter/ui'
import { useQuery } from '@tanstack/react-query'
import { Suspense, lazy, useState } from 'react'
import { useAuth } from './auth'
import { currentUserQueryOptions } from './current-user'
import { matterIdFromPath, resolveSection } from './navigation'
import { useSidebarData } from './sidebar-counts'
const ShellMenuPopup = lazy(() => import('./shell-menu-popup'))

export function ShellMenuButton() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { data: me } = useQuery(currentUserQueryOptions())
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const sidebarData = useSidebarData()
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
        <Suspense fallback={null}>
          <ShellMenuPopup
            me={me}
            section={section}
            currentMatterId={currentMatterId}
            sidebarData={sidebarData}
            onClose={close}
            onSignOut={signOutAndClose}
          />
        </Suspense>
      </PopoverPortal>
    </Popover>
  )
}
