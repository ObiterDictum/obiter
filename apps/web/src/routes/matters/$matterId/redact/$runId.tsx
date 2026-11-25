import { RedactionReviewView } from '@obiter/redact-ui/review'
import { redactionRunQueryOptions } from '@obiter/redact-ui/hooks'
import {
  currentUserQueryOptions,
  guardAuth,
  guardNotFound,
} from '@obiter/app-shell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/matters/$matterId/redact/$runId')({
  codeSplitGroupings: [['loader'], ['component']],
  loader: async ({ context, params, location }) => {
    await guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await guardNotFound(() =>
      context.queryClient.ensureQueryData(
        redactionRunQueryOptions(params.runId),
      ),
    )
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
