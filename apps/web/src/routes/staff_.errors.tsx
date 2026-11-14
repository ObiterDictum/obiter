import { createFileRoute } from '@tanstack/react-router'
import {
  currentUserQueryOptions,
  guardAuth,
  validateStaffErrorsSearch,
} from '@obiter/app-shell'
export const Route = createFileRoute('/staff_/errors')({
  validateSearch: validateStaffErrorsSearch,
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
})
