import { HomeRouteView, shellSnapshotQueryOptions } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/workspace')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(shellSnapshotQueryOptions('web')),
  component: WorkspaceRouteComponent,
})

function WorkspaceRouteComponent() {
  return <HomeRouteView platform="web" />
}
