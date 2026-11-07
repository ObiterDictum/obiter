import { createLazyFileRoute } from '@tanstack/react-router'
import { StaffRouteView } from '@obiter/app-shell/views/staff'

export const Route = createLazyFileRoute('/staff')({
  component: StaffRouteView,
})
