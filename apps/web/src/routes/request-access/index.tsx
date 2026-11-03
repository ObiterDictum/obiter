import { RequestAccessRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/request-access/')({
  component: RequestAccessRouteComponent,
})

function RequestAccessRouteComponent() {
  return <RequestAccessRouteView />
}
