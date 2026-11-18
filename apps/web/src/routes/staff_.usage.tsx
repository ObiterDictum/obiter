import { createFileRoute } from '@tanstack/react-router'
import {
  currentUserQueryOptions,
  guardAuth,
  validateStaffUsageSearch,
} from '@obiter/app-shell'

export const Route = createFileRoute('/staff_/usage')({
  validateSearch: validateStaffUsageSearch,
  loader: async ({ context, location }) => {
    await guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
})
