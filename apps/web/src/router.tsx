import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { getContext } from './integrations/tanstack-query/root-provider'
import { initServerRequest } from './lib/init-server-request'

export function getRouter() {
  initServerRequest()
  const context = getContext()
  const router = createTanStackRouter({
    routeTree,
    context,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  })

  setupRouterSsrQueryIntegration({
    queryClient: context.queryClient,
    router,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
