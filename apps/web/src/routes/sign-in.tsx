import { SignInRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/sign-in')({
  component: SignInRouteComponent,
})

function SignInRouteComponent() {
  return <SignInRouteView platform="web" />
}
