import { LegalSearchView } from '@obiter/app-shell/views/legal-search'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/search')({
  component: SearchRouteComponent,
})

function SearchRouteComponent() {
  return <LegalSearchView />
}
