import { createFileRoute } from '@tanstack/react-router'
import {
  currentUserQueryOptions,
  guardAuth,
  validateStaffErrorsSearch,
} from '@obiter/app-shell'
export const Route = createFileRoute('/staff_/errors')({
  validateSearch: validateStaffErrorsSearch,
  loader: async ({ context, location }) => {
    await guardAuth(location, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
})
