import { SignUpRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/sign-up')({
  component: SignUpRouteComponent,
})

function SignUpRouteComponent() {
  return <SignUpRouteView />
}
