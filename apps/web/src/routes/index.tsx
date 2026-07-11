import { HomeRouteView, prefetchHomeData } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    await prefetchHomeData(context.queryClient)
  },
  component: IndexRouteComponent,
})

function IndexRouteComponent() {
  return <HomeRouteView platform="web" />
}
