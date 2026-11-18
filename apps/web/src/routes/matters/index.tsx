import {
  MattersRouteView,
  currentUserQueryOptions,
  guardAuth,
  mattersListQueryOptions,
} from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/')({
  loader: async ({ context, location }) => {
    await guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await guardAuth(location, () =>
      context.queryClient.ensureQueryData(mattersListQueryOptions()),
    )
  },
  component: MattersIndexRouteComponent,
})

function MattersIndexRouteComponent() {
  return <MattersRouteView platform="web" />
}
