import {
  RedactionReviewView,
  redactionDocumentTextQueryOptions,
  redactionRunQueryOptions,
} from '@obiter/redact-ui'
import { currentUserQueryOptions, guardAuth } from '@obiter/app-shell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/redact/$runId')({
  loader: async ({ context, params }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await Promise.all([
      context.queryClient.prefetchQuery(redactionRunQueryOptions(params.runId)),
      context.queryClient.prefetchQuery(
        redactionDocumentTextQueryOptions(params.runId),
      ),
    ])
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
