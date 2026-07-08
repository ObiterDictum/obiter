import {
  CaseLawDocumentView,
  caseLawDocumentQueryOptions,
} from '@obiter/app-shell'
import { resolveCaseDocumentIdFromSlug } from '@obiter/contracts'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/case/$caseSlug')({
  loader: ({ context, params }) => {
    const caseId = resolveCaseDocumentIdFromSlug(params.caseSlug)

    return context.queryClient.ensureQueryData(caseLawDocumentQueryOptions(caseId))
  },
  component: CaseRouteComponent,
})

function CaseRouteComponent() {
  const { caseSlug } = Route.useParams()
  const caseId = resolveCaseDocumentIdFromSlug(caseSlug)

  return <CaseLawDocumentView caseId={caseId} />
}
