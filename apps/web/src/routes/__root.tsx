import {
  AppShellLayout,
  ShellError,
  ShellNotFound,
  ShellPermissionDenied,
  THEME_STORAGE_KEY,
  classifyShellFailure,
} from '@obiter/app-shell'
import type { QueryClient } from '@tanstack/react-query'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import favicon from '@obiter/ui/brand/logo/mark-32-ink-on-sand.png?url'
import touchIcon from '@obiter/ui/brand/logo/mark-256-ink-on-sand.png?url'
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
      {
        href: favicon,
        rel: 'icon',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        href: touchIcon,
        rel: 'apple-touch-icon',
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootShell,
  notFoundComponent: ShellNotFound,
  errorComponent: WebShellError,
})

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

function WebShellError(props: ErrorComponentProps) {
  const failure = classifyShellFailure(props.error)
  if (failure === 'not-found') return <ShellNotFound />
  if (failure === 'forbidden')
    return (
      <AppShellLayout platform="web">
        <ShellPermissionDenied />
      </AppShellLayout>
    )
  return <ShellError {...props} />
}

function RootShell() {
  return (
    <AppShellLayout platform="web">
      <Outlet />
    </AppShellLayout>
  )
}
