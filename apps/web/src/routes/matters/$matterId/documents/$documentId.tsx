import {
  DocumentDetailLayoutView,
  prefetchDocumentRouteData,
  useMatterTabsOptional,
  useRecordDocumentOpen,
} from '@obiter/app-shell'
import { RedactionRunsRegion } from '@obiter/redact-ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute(
  '/matters/$matterId/documents/$documentId',
)({
  validateSearch: (search: Record<string, unknown>) => {
    const verify =
      search.verify === 'run' || search.verify === 'open'
        ? search.verify
        : undefined
    return verify === undefined ? {} : { verify }
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
  const searchVerify = Route.useSearch().verify
  const verify =
    searchVerify === 'run' || searchVerify === 'open' ? searchVerify : undefined
  const [pending, setPending] = useState<{
    value: 'open' | 'run'
    seq: number
  } | null>(null)
  const seq = useRef(0)
  const navigate = useNavigate()
  const tabs = useMatterTabsOptional()
  useRecordDocumentOpen(documentId)

  useEffect(() => {
    if (!verify) return
    seq.current += 1
    setPending({ value: verify, seq: seq.current })
    void navigate({
      to: '/matters/$matterId/documents/$documentId',
      params: { matterId, documentId },
      search: (previous) => ({ ...previous, verify: undefined }),
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
