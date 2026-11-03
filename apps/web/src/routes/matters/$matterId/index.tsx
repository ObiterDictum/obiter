import { MatterRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/$matterId/')({
  component: MatterOverviewRoute,
})

function MatterOverviewRoute() {
  const { matterId } = Route.useParams()
  return <MatterRouteView matterId={matterId} platform="web" />
}
