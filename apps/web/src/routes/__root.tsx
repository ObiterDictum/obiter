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
  // Unknown paths and failed loaders keep the workspace chrome when the visitor
  // is signed in, so a dead end still offers the sidebar and a way back.
  notFoundComponent: ShellNotFound,
  errorComponent: WebShellError,
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

/**
 * A refusal inside a signed-in workspace keeps the chrome: the page is still
 * Obiter, and the sidebar is the way out. A route error is caught by this
 * boundary, which replaces the frame, so the frame is added back here (and the
 * layout sends a signed-out visitor to sign-in). A crash stays bare, because
 * the frame is the thing most likely to be what failed. A missing page already
 * renders inside the frame's outlet, so it is not wrapped again.
 */
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
