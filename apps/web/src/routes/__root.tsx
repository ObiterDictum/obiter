import { AppShellLayout } from '@ormont/app-shell'
import type { QueryClient } from '@tanstack/react-query'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import appCss from '../styles.css?url'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        content: 'width=device-width, initial-scale=1',
        name: 'viewport',
      },
      {
        title: 'Obiter',
      },
    ],
    links: [
      {
        href: appCss,
        rel: 'stylesheet',
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootShell,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={{ background: '#000000' }}>
      <head>
        <HeadContent />
      </head>
      <body style={{ background: '#000000', margin: 0, overflow: 'hidden' }}>
        <div style={{ background: '#000000', minHeight: '100dvh', overflow: 'hidden' }}>
          {children}
        </div>
        <Scripts />
      </body>
    </html>
  )
}

function RootShell() {
  return (
    <AppShellLayout platform="web">
      <Outlet />
    </AppShellLayout>
  )
}
