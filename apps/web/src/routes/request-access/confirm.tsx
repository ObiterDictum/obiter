import { RequestAccessConfirmRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/request-access/confirm')({
  component: RequestAccessConfirmRouteComponent,
})

function RequestAccessConfirmRouteComponent() {
  return <RequestAccessConfirmRouteView />
}
