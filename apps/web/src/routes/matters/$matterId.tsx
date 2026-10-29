import {
  MatterRouteView,
  currentUserQueryOptions,
  guardAuth,
  matterDocumentsQueryOptions,
  matterQueryOptions,
} from '@obiter/app-shell'
import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/$matterId')({
  loader: async ({ context, params }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(matterQueryOptions(params.matterId)),
    )
    await context.queryClient.prefetchQuery(
      matterDocumentsQueryOptions(params.matterId),
    )
  },
  component: MatterDetailRouteComponent,
})

function MatterDetailRouteComponent() {
  const { matterId } = Route.useParams()
  const onDocumentRoute = useRouterState({
    select: (state) =>
      state.matches.some(
        (match) => match.routeId === '/matters/$matterId/documents/$documentId',
      ),
  })

  if (onDocumentRoute) return <Outlet />

  return <MatterRouteView matterId={matterId} platform="web" />
}
