import {
  SettingsRouteView,
  currentUserQueryOptions,
  guardAuth,
  validateSettingsSearch,
} from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  validateSearch: validateSettingsSearch,
  loader: async ({ context, location }) => {
    await guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
  component: SettingsRouteComponent,
})

function SettingsRouteComponent() {
  return <SettingsRouteView />
}
