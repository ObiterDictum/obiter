import { AtlasCaseView, atlasDocumentQueryOptions } from '@ormont/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/cases/$caseId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(atlasDocumentQueryOptions(params.caseId)),
  component: CaseRouteComponent,
})

function CaseRouteComponent() {
  const { caseId } = Route.useParams()

  return <AtlasCaseView caseId={caseId} />
}
