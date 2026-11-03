import {
  DocumentDetailLayoutView,
  currentUserQueryOptions,
  documentQueryOptions,
  guardAuth,
  matterQueryOptions,
  useMatterTabsOptional,
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
  const tabs = useMatterTabsOptional()
  useRecordDocumentOpen(documentId)
  return (
    <DocumentDetailLayoutView
      matterId={matterId}
      documentId={documentId}
      onDocumentEdited={tabs?.promoteActive}
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
