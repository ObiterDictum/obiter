import {
  MatterRouteView,
  guardAuth,
  matterDocumentsQueryOptions,
  matterQueryOptions,
} from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/$matterId')({
  loader: async ({ context, params }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(matterQueryOptions(params.matterId)),
    )
    await context.queryClient.prefetchQuery(matterDocumentsQueryOptions(params.matterId))
  },
  component: MatterDetailRouteComponent,
})

function MatterDetailRouteComponent() {
  const { matterId } = Route.useParams()

  return <MatterRouteView matterId={matterId} platform="web" />
}
