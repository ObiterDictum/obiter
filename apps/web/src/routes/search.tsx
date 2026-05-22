import { AtlasSearchView } from '@ormont/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/search')({
  component: SearchRouteComponent,
})

function SearchRouteComponent() {
  return <AtlasSearchView />
}
