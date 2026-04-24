import { SignInRouteView } from '@ormont/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/sign-in')({
  component: SignInRouteComponent,
})

function SignInRouteComponent() {
  return <SignInRouteView platform="web" />
}
