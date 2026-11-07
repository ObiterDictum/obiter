export function scrubEvent<T extends object>(event: T): T {
  const allowed = new Set([
    'event_id',
    'timestamp',
    'platform',
    'level',
    'release',
    'environment',
    'sdk',
  ])
  for (const key of Object.keys(event)) {
    if (!allowed.has(key)) Reflect.deleteProperty(event, key)
  }
  Object.assign(event, { message: 'Application error' })
  return event
}

export function scrubBreadcrumb(_breadcrumb: unknown): null {
  return null
}

export const errorReportingOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  defaultIntegrations: false as const,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
}
