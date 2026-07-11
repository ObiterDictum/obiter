import {
  DocumentDetailLayoutView,
  documentQueryOptions,
  ensureOrganisation,
  guardAuth,
} from '@obiter/app-shell'
import { RedactionRunsRegion } from '@obiter/redact-ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

/**
 * Document detail (PRD FR4). A layout route: DocumentDetailLayoutView renders
 * the document metadata + redaction-runs region and an <Outlet/>, so feature
 * sub-routes (redact/$runId) nest beneath it. Backed by GET /api/documents/:id.
 */
export const Route = createFileRoute('/matters/$matterId/documents/$documentId')({
  loader: async ({ context, params }) => {
    await ensureOrganisation(context.queryClient)
    await guardAuth(context.queryClient, () =>
      context.queryClient.prefetchQuery(documentQueryOptions(params.documentId)),
    )
  },
  component: DocumentDetailRouteComponent,
})

function DocumentDetailRouteComponent() {
  const { matterId, documentId } = Route.useParams()
  const navigate = useNavigate()
  return <DocumentDetailLayoutView matterId={matterId} documentId={documentId} redactionRunsRegion={
    <RedactionRunsRegion
      documentId={documentId}
      onOpenRun={(runId) => navigate({ to: '/redact/$runId', params: { runId } })}
    />
  } />
}
