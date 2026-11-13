import type { ReactNode } from 'react'
import { ShellNotFound, ShellStaffTwoFactorRequired } from '../shell-states'
import { useCurrentUser } from '../current-user'

export function StaffGate({ children }: { children: ReactNode }) {
  const { data: me } = useCurrentUser()
  if (!me.isStaff) return <ShellNotFound />
  if (me.twoFactorEnabled !== true) return <ShellStaffTwoFactorRequired />
  return children
}
