import { RedactionReviewView } from '@obiter/redact-ui/review'
import { redactionRunQueryOptions } from '@obiter/redact-ui/hooks'
import { currentUserQueryOptions, guardAuth } from '@obiter/app-shell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/redact/$runId')({
  codeSplitGroupings: [['loader'], ['component']],
  loader: async ({ context, params, location }) => {
    await guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await context.queryClient.prefetchQuery(
      redactionRunQueryOptions(params.runId),
    )
  },
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
      onBack={() => navigate({ to: '/redact' })}
      onOpenDocument={({ matterId, documentId }) => {
        void navigate({
          to: '/matters/$matterId/documents/$documentId',
          params: { matterId, documentId },
        })
      }}
    />
  )
}
