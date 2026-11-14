import { createLazyFileRoute } from '@tanstack/react-router'
import { StaffFeedbackRouteView } from '@obiter/app-shell/views/staff-feedback'

export const Route = createLazyFileRoute('/staff_/feedback')({
  component: StaffFeedbackRouteView,
})
