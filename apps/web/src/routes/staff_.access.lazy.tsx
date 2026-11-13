import { createLazyFileRoute } from '@tanstack/react-router'
import { StaffGateView } from '@obiter/app-shell/views/staff-gate'

export const Route = createLazyFileRoute('/staff_/access')({
  component: StaffGateView,
})
