import { RedactionReviewView } from '@obiter/redact-ui'
import {
  redactionDocumentTextQueryOptions,
  redactionRunQueryOptions,
} from '@obiter/redact-ui/hooks'
import { currentUserQueryOptions, guardAuth } from '@obiter/app-shell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/$matterId/redact/$runId')({
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
  component: MatterRedactionReviewRoute,
})

function MatterRedactionReviewRoute() {
  const { matterId, runId } = Route.useParams()
  const navigate = useNavigate()
  return (
    <RedactionReviewView
      runId={runId}
      onOpenRun={(replacementRunId) =>
        navigate({
          to: '/matters/$matterId/redact/$runId',
          params: { matterId, runId: replacementRunId },
        })
      }
      onBack={() =>
        navigate({ to: '/matters/$matterId', params: { matterId } })
      }
      onOpenDocument={({ documentId }) => {
        void navigate({
          to: '/matters/$matterId/documents/$documentId',
          params: { matterId, documentId },
        })
      }}
    />
  )
}
