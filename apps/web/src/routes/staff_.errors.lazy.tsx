import { createLazyFileRoute } from '@tanstack/react-router'
import { StaffErrorsRouteView } from '@obiter/app-shell/views/staff-errors'
export const Route = createLazyFileRoute('/staff_/errors')({component:StaffErrorsRouteView})
