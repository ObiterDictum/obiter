import { ResetPasswordRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/reset-password')({
  // The better-auth reset callback appends ?token= or ?error= here. Search
  // params are read loosely inside the view; no validation schema is applied
  // at the route level so the callback's redirect always lands.
  component: ResetPasswordRouteComponent,
})

function ResetPasswordRouteComponent() {
  return <ResetPasswordRouteView />
}
