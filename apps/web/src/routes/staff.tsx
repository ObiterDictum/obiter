import { createFileRoute } from '@tanstack/react-router'
import { currentUserQueryOptions, guardAuth } from '@obiter/app-shell'

export const Route = createFileRoute('/staff')({
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
})
