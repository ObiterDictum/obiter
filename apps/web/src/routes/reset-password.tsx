import { ResetPasswordRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordRouteComponent,
})

function ResetPasswordRouteComponent() {
  return <ResetPasswordRouteView />
}
