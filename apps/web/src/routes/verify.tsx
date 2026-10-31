import { VerifyRouteView, prefetchVerifyData } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/verify')({
  loader: async ({ context }) => {
    await prefetchVerifyData(context.queryClient)
  },
  component: VerifyRouteComponent,
})

function VerifyRouteComponent() {
  return <VerifyRouteView />
}
