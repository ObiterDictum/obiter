import { createFileRoute } from '@tanstack/react-router'
import { currentUserQueryOptions, guardAuth } from '@obiter/app-shell'

export const Route = createFileRoute('/staff')({
  loader: async ({ context, location }) => {
    await guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
})
