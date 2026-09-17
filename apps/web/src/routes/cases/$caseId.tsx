import { caseLawDocumentQueryOptions } from '@obiter/app-shell/views/case-law-document-query'
import { createCanonicalCasePath } from '@obiter/contracts'
import { createFileRoute, redirect } from '@tanstack/react-router'

// This route only resolves an id to its canonical slug; it always redirects, so
// it renders no component. Importing CaseLawDocumentView here (as it once did)
// made the view shared by two dynamic routes, and the bundler hoisted it into
// the entry chunk every route preloads. The view now loads only with the
// canonical `/case/$caseSlug` route that actually renders it.
export const Route = createFileRoute('/cases/$caseId')({
  loader: async ({ context, params }) => {
    const response = await context.queryClient.ensureQueryData(
      caseLawDocumentQueryOptions(params.caseId),
    )
    const canonicalPath = createCanonicalCasePath(response.document)

    throw redirect({ href: canonicalPath })
  },
})
