import {
  currentUserQueryOptions,
  guardAuth,
  guardNotFound,
} from '@obiter/app-shell'
import { caseLawDocumentQueryOptions } from '@obiter/app-shell/views/case-law-document-query'
import { createCanonicalCasePath } from '@obiter/contracts/case-paths'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { caseLawRobotsHead } from '../../../http-policy.mjs'

export const Route = createFileRoute('/cases/$caseId')({
  head: caseLawRobotsHead,
  beforeLoad: ({ context, location }) =>
    guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    ),
  loader: async ({ context, params, location }) => {
    const response = await guardNotFound(() =>
      context.queryClient.ensureQueryData(
        caseLawDocumentQueryOptions(params.caseId),
      ),
    )
    const canonicalPath = createCanonicalCasePath(response.document)

    throw redirect({
      href: location.hash ? `${canonicalPath}#${location.hash}` : canonicalPath,
    })
  },
})
