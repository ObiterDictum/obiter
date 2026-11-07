interface ReportingUser {
  id: string
  organisationId?: string
}

let current: ReportingUser | undefined

export function rememberReportingUser(user: ReportingUser | undefined) {
  if (typeof window !== 'undefined') current = user
}

export function reportingUser() {
  return current
}
