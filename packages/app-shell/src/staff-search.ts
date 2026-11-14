import type { StaffFeedbackQuery } from '@obiter/contracts'

const STAFF_USAGE_WEEKS = new Set([4, 12, 26, 52])

export function validateStaffUsageSearch(search: Record<string, unknown>) {
  const weeks = Number(search.weeks)
  return STAFF_USAGE_WEEKS.has(weeks) ? { weeks } : {}
}

export function validateStaffFeedbackSearch(
  search: Record<string, unknown>,
): StaffFeedbackQuery {
  const kind =
    search.kind === 'problem' ||
    search.kind === 'idea' ||
    search.kind === 'question'
      ? search.kind
      : undefined
  const status =
    search.status === 'handled' || search.status === 'all'
      ? search.status
      : 'open'
  return { ...(kind ? { kind } : {}), status }
}

export function staffUsageWeeks(search: Record<string, unknown>): number {
  return validateStaffUsageSearch(search).weeks ?? 12
}

export function validateStaffErrorsSearch(search: Record<string, unknown>) {
  const days = Number(search.days)
  return [7, 30, 90].includes(days) ? { days } : {}
}
