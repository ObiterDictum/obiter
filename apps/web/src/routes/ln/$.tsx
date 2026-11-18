import { prefetchLegislationPage } from '@obiter/app-shell'
import { LegislationRouteView } from '@obiter/app-shell/views/legislation-route'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/ln/$')({
  loader: ({ context, params }) =>
    prefetchLegislationPage(context.queryClient, requireSplat(params._splat)),
  component: LegislationRouteComponent,
})

function LegislationRouteComponent() {
  return <LegislationRouteView path={requireSplat(Route.useParams()._splat)} />
}

function requireSplat(path: string | undefined) {
  if (!path) throw new Error('Legislation path is missing.')
  return path
}
