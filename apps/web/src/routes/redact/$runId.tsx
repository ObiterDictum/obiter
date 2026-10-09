import { RedactionReviewView } from '@obiter/redact-ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/redact/$runId')({
  component: RedactionReviewRoute,
})

function RedactionReviewRoute() {
  const { runId } = Route.useParams()
  const navigate = useNavigate()
  return (
    <RedactionReviewView
      runId={runId}
      onOpenRun={(replacementRunId) =>
        navigate({
          to: '/redact/$runId',
          params: { runId: replacementRunId },
        })
      }
      onOpenDocument={(run) => {
        if (!run.documentId || !run.matterId) return
        void navigate({
          to: '/matters/$matterId/documents/$documentId',
          params: { matterId: run.matterId, documentId: run.documentId },
        })
      }}
    />
  )
}
