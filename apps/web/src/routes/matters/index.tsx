import { MattersRouteView, shellSnapshotQueryOptions } from '@ormont/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(shellSnapshotQueryOptions('web')),
  component: MattersIndexRouteComponent,
})

function MattersIndexRouteComponent() {
  return <MattersRouteView platform="web" />
}
