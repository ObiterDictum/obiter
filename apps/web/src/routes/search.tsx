import { LegalSearchView } from '@obiter/app-shell/views/legal-search'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>) => {
    const query = search.q
    if (typeof query !== 'string' || !query.trim()) return {}
    return { q: query }
  },
  component: SearchRouteComponent,
})

function SearchRouteComponent() {
  return <LegalSearchView />
}
