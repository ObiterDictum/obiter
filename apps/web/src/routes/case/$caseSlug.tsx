import {
  CaseLawDocumentView,
  caseLawDocumentQueryOptions,
} from '@ormont/app-shell'
import { resolveCaseDocumentIdFromSlug } from '@ormont/contracts'
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
