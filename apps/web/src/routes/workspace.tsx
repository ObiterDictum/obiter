import {
  HomeRouteView,
  changelogQueryOptions,
  currentUserQueryOptions,
  guardAuth,
  mattersListQueryOptions,
} from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/workspace')({
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      Promise.all([
        context.queryClient.ensureQueryData(currentUserQueryOptions()),
        context.queryClient.ensureQueryData(changelogQueryOptions()),
      ]),
    )
    // Matters list is non-suspense in the view (renders a skeleton); prefetch
    // so it appears immediately when data is ready.
    await guardAuth(context.queryClient, () =>
      context.queryClient.prefetchQuery(mattersListQueryOptions()),
    )
  },
  component: WorkspaceRouteComponent,
})

function WorkspaceRouteComponent() {
  return <HomeRouteView platform="web" />
}
