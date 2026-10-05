import {
  LegislationActView,
  legislationActQueryOptions,
  LegislationProvisionView,
  legislationProvisionQueryOptions,
} from '@obiter/app-shell'
import {
  parseLegislationActPath,
  parseLegislationProvisionPath,
} from '@obiter/contracts'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/ln/$')({
  loader: ({ context, params }) => {
    const splat = requireSplat(params._splat)
    if (parseLegislationProvisionPath(splat)) {
      return context.queryClient.ensureQueryData(
        legislationProvisionQueryOptions(splat),
      )
    }
    return context.queryClient.ensureQueryData(
      legislationActQueryOptions(requireActIdentity(splat)),
    )
  },
  component: LegislationRouteComponent,
})

function LegislationRouteComponent() {
  const { _splat } = Route.useParams()
  const splat = requireSplat(_splat)
  if (parseLegislationProvisionPath(splat)) {
    return <LegislationProvisionView provisionPath={splat} />
  }
  return <LegislationActView identity={requireActIdentity(splat)} />
}

function requireSplat(path: string | undefined) {
  if (!path) {
    throw new Error('Legislation path is missing.')
  }
  return path
}

function requireActIdentity(splat: string) {
  const parsed = parseLegislationActPath(splat)
  if (!parsed) {
    throw new Error('Legislation path is invalid.')
  }
  return parsed.documentIdentity
}
