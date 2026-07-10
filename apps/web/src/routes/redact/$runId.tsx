import { RedactionReviewView } from '@obiter/redact-ui'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/redact/$runId')({
  component: RedactionReviewRoute,
})

function RedactionReviewRoute() {
  const { runId } = Route.useParams()
  return <RedactionReviewView runId={runId} />
}
