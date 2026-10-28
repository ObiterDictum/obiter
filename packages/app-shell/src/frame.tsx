import { useQuery } from '@tanstack/react-query'
import { Navigate, useRouterState } from '@tanstack/react-router'
import type { AppPlatform } from '@obiter/contracts'
import { ToastProvider, Toaster } from '@obiter/ui'
import { useRef, useState, type ReactNode } from 'react'
import { AgentPanel } from './agent-panel'
import { useAuth } from './auth'
import { currentUserQueryOptions } from './current-user'
import { ShellBootLoading, ShellOfflineBanner } from './shell-states'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'

/**
 * App frame. Gates the shell on a real better-auth session: unauthenticated
 * users are redirected to /sign-in. Auth routes render bare (no workspace
 * chrome). The authenticated frame is one labelled sidebar, a thin top bar for
 * breadcrumbs, search and the account, and the scrolling content column.
 */
export function AppShellLayout({
  children,
  platform,
}: {
  children: ReactNode
  platform: AppPlatform
}) {
  const { session, isPending } = useAuth()
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isAuthRoute =
    currentPath === '/sign-in' ||
    currentPath === '/sign-up' ||
    currentPath === '/forgot-password' ||
    currentPath === '/reset-password' ||
    currentPath === '/invites/accept'

  let body: ReactNode

  if (isAuthRoute) {
    body = children
  } else if (isPending) {
    body = <ShellBootLoading />
  } else if (!session) {
    body = <Navigate to="/sign-in" />
  } else {
    body = (
      <AuthenticatedFrame platform={platform}>{children}</AuthenticatedFrame>
    )
  }

  return (
    <ToastProvider>
      {body}
      <Toaster />
    </ToastProvider>
  )
}

function AuthenticatedFrame({
  children,
  platform,
}: {
  children: ReactNode
  platform: AppPlatform
}) {
  const { data: me } = useQuery(currentUserQueryOptions())
  const [agentOpen, setAgentOpen] = useState(false)
  const agentTriggerRef = useRef<HTMLButtonElement>(null)

  // Closing the panel returns focus to the row that opened it, so a keyboard
  // user is never dropped back at the top of the document.
  function closeAgent() {
    setAgentOpen(false)
    agentTriggerRef.current?.focus()
  }

  return (
    <div className="flex h-dvh bg-canvas text-ink">
      <Sidebar
        orgName={me?.organisation?.name}
        agentOpen={agentOpen}
        onToggleAgent={() => (agentOpen ? closeAgent() : setAgentOpen(true))}
        agentTriggerRef={agentTriggerRef}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar platform={platform} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <ShellOfflineBanner />
          {children}
        </main>
      </div>
      {agentOpen ? <AgentPanel onClose={closeAgent} /> : null}
    </div>
  )
}
