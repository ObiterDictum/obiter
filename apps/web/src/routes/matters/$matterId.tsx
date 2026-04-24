import { MatterRouteView, shellSnapshotQueryOptions } from '@ormont/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/$matterId')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(shellSnapshotQueryOptions('web')),
  component: MatterDetailRouteComponent,
})

function MatterDetailRouteComponent() {
  const { matterId } = Route.useParams()

  return <MatterRouteView matterId={matterId} platform="web" />
}
