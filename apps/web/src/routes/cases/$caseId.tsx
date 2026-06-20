import { CaseLawDocumentView, caseLawDocumentQueryOptions } from '@ormont/app-shell'
import { createCanonicalCasePath } from '@ormont/contracts'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/cases/$caseId')({
  loader: async ({ context, params }) => {
    const document = await context.queryClient.ensureQueryData(caseLawDocumentQueryOptions(params.caseId))
    const canonicalPath = createCanonicalCasePath(document)

    throw redirect({ href: canonicalPath })
  },
  component: CaseRouteComponent,
})

function CaseRouteComponent() {
  const { caseId } = Route.useParams()

  return <CaseLawDocumentView caseId={caseId} />
}
