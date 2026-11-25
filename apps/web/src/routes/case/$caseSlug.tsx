import {
  currentUserQueryOptions,
  guardAuth,
  guardNotFound,
} from '@obiter/app-shell'
import { CaseLawDocumentView } from '@obiter/app-shell/views/case-law-document'
import { caseLawDocumentQueryOptions } from '@obiter/app-shell/views/case-law-document-query'
import { resolveCaseDocumentIdFromSlug } from '@obiter/contracts/case-paths'
import { createFileRoute } from '@tanstack/react-router'
import { caseLawRobotsHead } from '../../../http-policy.mjs'

export const Route = createFileRoute('/case/$caseSlug')({
  head: caseLawRobotsHead,
  beforeLoad: ({ context, location }) =>
    guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    ),
  loader: async ({ context, params }) => {
    const caseId = resolveCaseDocumentIdFromSlug(params.caseSlug)

    await guardNotFound(() =>
      context.queryClient.ensureQueryData(caseLawDocumentQueryOptions(caseId)),
    )
  },
  component: CaseRouteComponent,
})

function CaseRouteComponent() {
  const { caseSlug } = Route.useParams()
  const caseId = resolveCaseDocumentIdFromSlug(caseSlug)

  return <CaseLawDocumentView caseId={caseId} />
}
