import {
  AppShellLayout,
  ShellError,
  ShellNotFound,
  THEME_STORAGE_KEY,
} from '@obiter/app-shell'
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
  // Unknown paths and failed loaders render inside the same shell chrome, so a
  // dead end still offers the sidebar and a way back.
  notFoundComponent: ShellNotFound,
  errorComponent: ShellError,
})

/**
 * Applies a saved dark choice before the first paint. Light is the default, so
 * only "dark" — or "system" on a machine that asks for dark — needs the
 * attribute changed; doing it here rather than in an effect stops a dark
 * preference flashing light on every load.
 */
const THEME_BOOTSTRAP = `try{var d=document.documentElement,t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||t==='light'){d.dataset.theme=t}else if(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches){d.dataset.theme='dark'}}catch(e){}`

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" data-theme="light">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
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
