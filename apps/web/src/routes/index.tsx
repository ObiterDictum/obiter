import { SignInRouteView } from '@ormont/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: IndexRouteComponent,
})

function IndexRouteComponent() {
  return <SignInRouteView platform="web" />
}
