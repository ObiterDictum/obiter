import { RedactionReviewView } from '@obiter/redact-ui'
import { ensureOrganisation } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/redact/$runId')({
  loader: ({ context }) => ensureOrganisation(context.queryClient),
  component: RedactionReviewRoute,
})

function RedactionReviewRoute() {
  const { runId } = Route.useParams()
  return <RedactionReviewView runId={runId} />
}
