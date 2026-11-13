import { createLazyFileRoute } from '@tanstack/react-router'
import { StaffOverviewRouteView } from '@obiter/app-shell/views/staff-overview'

export const Route = createLazyFileRoute('/staff')({
  component: StaffOverviewRouteView,
})
