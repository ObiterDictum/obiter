import {
  DocumentDetailLayoutView,
  prefetchDocumentRouteData,
  useMatterTabsOptional,
  useRecordDocumentOpen,
} from '@obiter/app-shell'
import { RedactionRunsRegion } from '@obiter/redact-ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute(
  '/matters/$matterId/documents/$documentId',
)({
  validateSearch: (
    search: Record<string, unknown>,
  ): { verify?: 'run' | 'open' } => {
    const verify = search.verify
    return verify === 'run' || verify === 'open' ? { verify } : {}
  },
  loader: ({ context, params, location }) =>
    prefetchDocumentRouteData(
      context.queryClient,
      location,
      params.matterId,
      params.documentId,
    ),
  component: DocumentDetailRouteComponent,
})

function DocumentDetailRouteComponent() {
  const { matterId, documentId } = Route.useParams()
  const verify = Route.useSearch().verify
  const [pending, setPending] = useState<{
    value: 'open' | 'run'
    seq: number
  } | null>(null)
  const navigate = useNavigate()
  const tabs = useMatterTabsOptional()
  useRecordDocumentOpen(documentId)

  useEffect(() => {
    if (!verify) return
    setPending((previous) => ({
      value: verify,
      seq: (previous?.seq ?? 0) + 1,
    }))
    void navigate({
      to: '/matters/$matterId/documents/$documentId',
      params: { matterId, documentId },
      search: {},
      replace: true,
    })
  }, [verify, navigate, matterId, documentId])

  return (
    <DocumentDetailLayoutView
      matterId={matterId}
      documentId={documentId}
      verifyRequest={pending}
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
