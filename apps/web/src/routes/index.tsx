import {
  HomeRouteView,
  changelogQueryOptions,
  currentUserQueryOptions,
  guardAuth,
  mattersListQueryOptions,
} from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      Promise.all([
        context.queryClient.ensureQueryData(currentUserQueryOptions()),
        context.queryClient.ensureQueryData(changelogQueryOptions()),
      ]),
    )
    await context.queryClient.prefetchQuery(mattersListQueryOptions())
  },
  component: IndexRouteComponent,
})

function IndexRouteComponent() {
  return <HomeRouteView platform="web" />
}
