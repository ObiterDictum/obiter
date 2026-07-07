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
        rel: 'preconnect',
        href: 'https://api.fontshare.com',
      },
      {
        rel: 'stylesheet',
        href: 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&f[]=jetbrains-mono@400,500&display=swap',
      },
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
    <html lang="en" data-theme="light">
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0 }}>
        {children}
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
