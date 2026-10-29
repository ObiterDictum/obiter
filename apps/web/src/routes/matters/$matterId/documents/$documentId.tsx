import {
  DocumentDetailLayoutView,
  currentUserQueryOptions,
  documentQueryOptions,
  guardAuth,
  matterQueryOptions,
  useRecordDocumentOpen,
} from '@obiter/app-shell'
import { RedactionRunsRegion } from '@obiter/redact-ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

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
    await guardAuth(context.queryClient, () =>
      context.queryClient.prefetchQuery(matterQueryOptions(params.matterId)),
    )
  },
  component: DocumentDetailRouteComponent,
})

function DocumentDetailRouteComponent() {
  const { matterId, documentId } = Route.useParams()
  const navigate = useNavigate()
  useRecordDocumentOpen(documentId)
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
