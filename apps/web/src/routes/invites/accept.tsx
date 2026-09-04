import {
  AcceptInviteRouteView,
  prefetchInviteAcceptData,
} from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/invites/accept')({
  loader: async ({ context, location }) => {
    const token =
      new URLSearchParams(location.searchStr.replace(/^\?/u, '')).get(
        'token',
      ) ?? ''
    await prefetchInviteAcceptData(context.queryClient, token)
  },
  component: AcceptInviteRouteComponent,
})

function AcceptInviteRouteComponent() {
  return <AcceptInviteRouteView />
}
