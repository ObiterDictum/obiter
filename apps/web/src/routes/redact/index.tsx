import { RedactionRunsView } from '@obiter/redact-ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/redact/')({
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
