import { createLazyFileRoute } from '@tanstack/react-router'
import { StaffUsageRouteView } from '@obiter/app-shell/views/staff-usage'

export const Route = createLazyFileRoute('/staff_/usage')({
  component: StaffUsageRouteView,
})
