import { VerifyRouteView, prefetchVerifyData } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/$matterId/verify')({
  loader: async ({ context }) => {
    await prefetchVerifyData(context.queryClient)
  },
  component: MatterVerifyRoute,
})

function MatterVerifyRoute() {
  const { matterId } = Route.useParams()
  return <VerifyRouteView matterId={matterId} />
}
