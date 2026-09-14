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
  // The document detail is a full-page view, not a pane inside the matter page.
  // File-based routing nests it under this route, so render the matched child
  // and skip the matter page; without this the document route never renders on
  // web (desktop registers the same path as a top-level sibling).
  const onDocumentRoute = useRouterState({
    select: (state) =>
      state.matches.some(
        (match) => match.routeId === '/matters/$matterId/documents/$documentId',
      ),
  })

  if (onDocumentRoute) return <Outlet />

  return <MatterRouteView matterId={matterId} platform="web" />
}
