import {
  DocumentDetailLayoutView,
  currentUserQueryOptions,
  documentQueryOptions,
  guardAuth,
  matterQueryOptions,
} from '@obiter/app-shell'
import { RedactionRunsRegion } from '@obiter/redact-ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

/**
 * Document detail (PRD FR4). A layout route: DocumentDetailLayoutView renders
 * the document metadata + redaction-runs region and an <Outlet/>, so feature
 * sub-routes (redact/$runId) nest beneath it. Backed by GET /api/documents/:id.
 */
export const Route = createFileRoute(
  '/matters/$matterId/documents/$documentId',
)({
  loader: async ({ context, params }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
    await guardAuth(context.queryClient, () =>
      context.queryClient.prefetchQuery(
        documentQueryOptions(params.documentId),
      ),
    )
    // The editor header names the matter, so the breadcrumb is there on a
    // direct load rather than appearing a moment later.
    await guardAuth(context.queryClient, () =>
      context.queryClient.prefetchQuery(matterQueryOptions(params.matterId)),
    )
  },
  component: DocumentDetailRouteComponent,
})

function DocumentDetailRouteComponent() {
  const { matterId, documentId } = Route.useParams()
  const navigate = useNavigate()
  return (
    <DocumentDetailLayoutView
      matterId={matterId}
      documentId={documentId}
      redactionRunsRegion={
        <RedactionRunsRegion
          documentId={documentId}
          onOpenRun={(runId) =>
            navigate({ to: '/redact/$runId', params: { runId } })
          }
        />
      }
    />
  )
}
