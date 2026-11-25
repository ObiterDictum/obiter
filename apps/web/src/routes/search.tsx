import { validateLegalSearchSearch } from '@obiter/app-shell/legal-search-url'
import { LegalSearchView } from '@obiter/app-shell/views/legal-search'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/search')({
  validateSearch: validateLegalSearchSearch,
  component: SearchRouteComponent,
})

function SearchRouteComponent() {
  return <LegalSearchView />
}
