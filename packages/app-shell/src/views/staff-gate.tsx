import { ShellNotFound, ShellStaffTwoFactorRequired } from '../shell-states'
import { useCurrentUser } from '../current-user'
import { StaffRouteView } from './staff'

export function StaffGateView() {
  const { data: me } = useCurrentUser()
  if (!me.isStaff) return <ShellNotFound />
  if (me.twoFactorEnabled !== true) return <ShellStaffTwoFactorRequired />
  return <StaffRouteView />
}
