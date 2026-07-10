import { DocumentDetailLayoutView } from '@obiter/app-shell'
import { RedactionRunsRegion } from '@obiter/redact-ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

/**
 * Document detail (PRD FR4). A layout route: DocumentDetailLayoutView renders
 * the document metadata + redaction-runs region and an <Outlet/>, so feature
 * sub-routes (redact/$runId) nest beneath it. M1 ships the chrome; real data is
 * M2 (documents) and Redact PRD 2 (runs).
 */
export const Route = createFileRoute('/matters/$matterId/documents/$documentId')({
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
