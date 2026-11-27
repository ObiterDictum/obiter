import {
  currentUserQueryOptions,
  guardAuth,
  prefetchLegislationPage,
} from '@obiter/app-shell'
import { LegislationRouteView } from '@obiter/app-shell/views/legislation-route'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { caseLawRobotsHead } from '../../../http-policy.mjs'

export const Route = createFileRoute('/ln/$')({
  head: caseLawRobotsHead,
  beforeLoad: ({ context, location }) =>
    guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    ),
  loader: ({ context, location, params }) =>
    guardAuth(location, async () => {
      await prefetchLegislationPage(
        context.queryClient,
        requireSplat(params._splat),
      )
    }),
  component: LegislationRouteComponent,
})

function LegislationRouteComponent() {
  return <LegislationRouteView path={requireSplat(Route.useParams()._splat)} />
}

function requireSplat(path: string | undefined) {
  if (!path) throw notFound()
  return path
}
