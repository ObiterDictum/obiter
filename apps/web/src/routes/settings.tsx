import {
  SettingsRouteView,
  currentUserQueryOptions,
  guardAuth,
} from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
  component: SettingsRouteComponent,
})

function SettingsRouteComponent() {
  return <SettingsRouteView />
}
