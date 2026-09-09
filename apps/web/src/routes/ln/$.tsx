import {
  LegislationProvisionView,
  legislationProvisionQueryOptions,
} from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/ln/$')({
  loader: ({ context, params }) => {
    const provisionPath = requireProvisionPath(params._splat)
    return context.queryClient.ensureQueryData(
      legislationProvisionQueryOptions(provisionPath),
    )
  },
  component: LegislationRouteComponent,
})

function LegislationRouteComponent() {
  const { _splat } = Route.useParams()
  return (
    <LegislationProvisionView provisionPath={requireProvisionPath(_splat)} />
  )
}

function requireProvisionPath(path: string | undefined) {
  if (!path) {
    throw new Error('Legislation provision path is missing.')
  }
  return path
}
