import { DocumentDetailLayoutView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

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
  return <DocumentDetailLayoutView matterId={matterId} documentId={documentId} />
}
