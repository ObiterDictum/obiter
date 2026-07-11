import {
  MattersRouteView,
  ensureOrganisation,
  guardAuth,
  mattersListQueryOptions,
} from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/')({
  loader: async ({ context }) => {
    // Org-scoped: an authenticated but org-less user is redirected to Home
    // (create-organisation) rather than hitting a 403 from the matters API.
    await ensureOrganisation(context.queryClient)
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(mattersListQueryOptions()),
    )
  },
  component: MattersIndexRouteComponent,
})

function MattersIndexRouteComponent() {
  return <MattersRouteView platform="web" />
}
