import { caseLawDocumentQueryOptions } from '@obiter/app-shell/views/case-law-document-query'
import { createCanonicalCasePath } from '@obiter/contracts/case-paths'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/cases/$caseId')({
  loader: async ({ context, params }) => {
    const response = await context.queryClient.ensureQueryData(
      caseLawDocumentQueryOptions(params.caseId),
    )
    const canonicalPath = createCanonicalCasePath(response.document)

    throw redirect({ href: canonicalPath })
  },
})
