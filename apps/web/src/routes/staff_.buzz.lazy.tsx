import { createLazyFileRoute } from '@tanstack/react-router'
import { StaffBuzzRouteView } from '@obiter/app-shell/views/staff-buzz'
export const Route = createLazyFileRoute('/staff_/buzz')({
  component: StaffBuzzRouteView,
})
