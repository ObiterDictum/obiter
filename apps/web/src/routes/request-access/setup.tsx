import { createFileRoute } from '@tanstack/react-router'
import { AccessSetupRouteView } from '@obiter/app-shell'

export const Route = createFileRoute('/request-access/setup')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: AccessSetupRouteView,
})
