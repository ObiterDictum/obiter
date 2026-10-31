import { RedactionRunsView, redactionRunsQueryOptions } from '@obiter/redact-ui'
import { currentUserQueryOptions, guardAuth } from '@obiter/app-shell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/redact/')({
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await context.queryClient.prefetchQuery(redactionRunsQueryOptions())
  },
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
