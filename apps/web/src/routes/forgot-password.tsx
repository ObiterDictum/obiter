import { ForgotPasswordRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordRouteComponent,
})

function ForgotPasswordRouteComponent() {
  return <ForgotPasswordRouteView />
}
