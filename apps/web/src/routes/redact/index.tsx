import { RedactionRunsView } from '@obiter/redact-ui'
import { ensureOrganisation } from '@obiter/app-shell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/redact/')({
  // Org-scoped at the routing level: an org-less user is redirected to Home
  // (create-organisation) before any Redact surface renders. No Redact
  // internals are changed.
  loader: ({ context }) => ensureOrganisation(context.queryClient),
  component: RedactionRunsRoute,
})

function RedactionRunsRoute() {
  const navigate = useNavigate()
  return (
    <RedactionRunsView
      onOpenRun={(runId) =>
        navigate({ to: '/redact/$runId', params: { runId } })
      }
    />
  )
}
