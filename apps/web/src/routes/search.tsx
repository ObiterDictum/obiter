import { currentUserQueryOptions, guardAuth } from '@obiter/app-shell'
import { validateLegalSearchSearch } from '@obiter/app-shell/legal-search-url'
import { LegalSearchView } from '@obiter/app-shell/views/legal-search'
import { createFileRoute } from '@tanstack/react-router'
import { caseLawRobotsHead } from '../../http-policy.mjs'

export const Route = createFileRoute('/search')({
  head: caseLawRobotsHead,
  beforeLoad: ({ context, location }) =>
    guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    ),
  validateSearch: validateLegalSearchSearch,
  component: SearchRouteComponent,
})

function SearchRouteComponent() {
  return <LegalSearchView />
}
