import {
  parseLegislationActPath,
  parseLegislationProvisionPath,
} from '@obiter/contracts/legislation-paths'
import { useLocation } from '@tanstack/react-router'
import { LegislationActView } from './LegislationActView'
import { LegislationProvisionView } from './LegislationProvisionView'

export function LegislationRouteView({ path }: { path: string }) {
  const hash = useLocation({ select: (location) => location.hash })
  if (parseLegislationProvisionPath(path)) {
    return <LegislationProvisionView provisionPath={path} />
  }
  const act = parseLegislationActPath(path)
  if (!act) throw new Error('Legislation path is invalid.')
  return <LegislationActView identity={act.documentIdentity} hash={hash} />
}
