import { RedactionReviewView } from '@obiter/redact-ui'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/$matterId/documents/$documentId/redact/$runId')({
  component: RedactionReviewRoute,
})

function RedactionReviewRoute() {
  const { matterId, documentId, runId } = Route.useParams()
  return <RedactionReviewView matterId={matterId} documentId={documentId} runId={runId} />
}
