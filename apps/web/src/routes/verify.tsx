import { VerifyRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/verify')({
  component: VerifyRouteComponent,
})

function VerifyRouteComponent() {
  return <VerifyRouteView />
}
