import {
  currentUserQueryOptions,
  guardAuth,
  matterDocumentsQueryOptions,
  matterQueryOptions,
} from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/$matterId')({
  loader: async ({ context, params, location }) => {
    await guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await guardAuth(location, () =>
      context.queryClient.ensureQueryData(matterQueryOptions(params.matterId)),
    )
    await context.queryClient.prefetchQuery(
      matterDocumentsQueryOptions(params.matterId),
    )
  },
})
