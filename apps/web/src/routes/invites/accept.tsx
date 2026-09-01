import { AcceptInviteRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/invites/accept')({
  component: AcceptInviteRouteComponent,
})

function AcceptInviteRouteComponent() {
  return <AcceptInviteRouteView />
}
