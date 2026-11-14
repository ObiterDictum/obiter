import { createFileRoute } from '@tanstack/react-router'
import {
  currentUserQueryOptions,
  guardAuth,
  validateStaffFeedbackSearch,
} from '@obiter/app-shell'

export const Route = createFileRoute('/staff_/feedback')({
  validateSearch: validateStaffFeedbackSearch,
  loader: async ({ context }) => {
    await guardAuth(context.queryClient, () =>
      context.queryClient.ensureQueryData(currentUserQueryOptions()),
    )
  },
})
