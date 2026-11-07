import type { ErrorEvent, Breadcrumb } from '@sentry/core'

export function redactMessage(message: string): string {
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(
      /"[^"]*"|'[^']*'|\u201c[^\u201d]*\u201d|\u2018[^\u2019]*\u2019/g,
      '[quoted]',
    )
    .replace(/\d{6,}/g, '[number]')
    .replace(/\S{41,}/g, '[long]')
    .slice(0, 300)
}

const routeSegments = new Set(
  'api matters documents users organisations auth sign-in sign-out sign-up search fetch redact redaction runs versions comments replies shares sources verify findings settings account health access-requests changelog assets index.html outputs presence updates invites sessions me password reset verify-email case-law legislation acts provisions authorities files upload download'.split(
    ' ',
  ),
)

export function routePattern(raw: string): string {
  const path =
    raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '/'
  return (
    '/' +
    path
      .split('/')
      .filter(Boolean)
      .map((part) =>
        routeSegments.has(part) ||
        /^[:$][a-zA-Z]+$/.test(part) ||
        /^\d+$/.test(part) ||
        /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(part) ||
        /^(?:usr|user|org|mat|matter|doc|document|run|ver|version|req)_[a-zA-Z0-9_-]+$/.test(
          part,
        )
          ? part
          : ':value',
      )
      .join('/')
  )
}

type DiagnosticValue =
  | string
  | number
  | boolean
  | null
  | DiagnosticValue[]
  | { [key: string]: DiagnosticValue }
type DiagnosticData = { [key: string]: DiagnosticValue }
const sensitiveKey =
  /document.*text|file.*name|matter.*name|search.*query|redaction.*value|body|cookie|authorization|headers|query|string|fragment|password|token|secret/i

function scrubData(value: unknown, depth = 0): DiagnosticValue | undefined {
  if (depth > 8) return undefined
  if (typeof value === 'string')
    return value.length > 200 ? undefined : redactMessage(value)
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return value
  if (Array.isArray(value))
    return value.slice(0, 100).flatMap((item) => {
      const clean = scrubData(item, depth + 1)
      return clean === undefined ? [] : [clean]
    })
  if (typeof value !== 'object') return undefined
  const result: DiagnosticData = {}
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key)) continue
    const clean =
      /^(url|route|from|to)$/i.test(key) && typeof item === 'string'
        ? routePattern(item)
        : scrubData(item, depth + 1)
    if (clean !== undefined) result[key] = clean
  }
  return result
}

function scrubFields(
  fields: Record<string, unknown> | undefined,
): DiagnosticData | undefined {
  if (!fields) return undefined
  const clean: DiagnosticData = {}
  for (const [key, value] of Object.entries(fields)) {
    if (sensitiveKey.test(key)) continue
    const result =
      /^(url|route|from|to)$/i.test(key) && typeof value === 'string'
        ? routePattern(value)
        : scrubData(value)
    if (result !== undefined) clean[key] = result
  }
  return clean
}

function sourceFile(filename: string | undefined): string | undefined {
  const file = filename?.split(/[?#]/)[0]?.split(/[/\\]/).pop()
  return file && /\.(?:[cm]?js|tsx?)$/.test(file) ? file : undefined
}

function method(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(value)
    ? value
    : undefined
}

export function scrubEvent(event: Partial<ErrorEvent>): ErrorEvent {
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    release: event.release,
    environment: event.environment,
    sdk: event.sdk,
    message: event.message ? redactMessage(event.message) : undefined,
    exception: event.exception
      ? {
          values: event.exception.values?.map((exception) => ({
            type: exception.type ? redactMessage(exception.type) : undefined,
            value: exception.value ? redactMessage(exception.value) : undefined,
            stacktrace: exception.stacktrace
              ? {
                  frames: exception.stacktrace.frames?.map((frame) => ({
                    function: frame.function
                      ? redactMessage(frame.function)
                      : undefined,
                    filename: sourceFile(frame.filename),
                    lineno: frame.lineno,
                    colno: frame.colno,
                  })),
                }
              : undefined,
          })),
        }
      : undefined,
    request: event.request
      ? {
          url: event.request.url ? routePattern(event.request.url) : undefined,
          method: method(event.request.method),
        }
      : undefined,
    transaction: event.transaction
      ? routePattern(event.transaction)
      : undefined,
    tags:
      typeof event.tags?.status === 'number'
        ? { status: event.tags.status }
        : undefined,
    user: event.user
      ? {
          id: event.user.id,
          organisationId:
            typeof event.user.organisationId === 'string'
              ? event.user.organisationId
              : undefined,
        }
      : undefined,
    extra: scrubFields(event.extra),
    contexts: event.contexts
      ? Object.fromEntries(
          Object.entries(event.contexts).map(([key, value]) => [
            key,
            sensitiveKey.test(key) ? undefined : scrubFields(value),
          ]),
        )
      : undefined,
    breadcrumbs: event.breadcrumbs
      ?.map(scrubBreadcrumb)
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null),
  }
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null
  if (
    ['navigation', 'fetch', 'xhr', 'http'].includes(breadcrumb.category ?? '')
  ) {
    const raw = breadcrumb.data?.url ?? breadcrumb.data?.to
    return {
      category: breadcrumb.category,
      data: {
        url: typeof raw === 'string' ? routePattern(raw) : undefined,
        method: method(breadcrumb.data?.method),
        status_code:
          typeof breadcrumb.data?.status_code === 'number'
            ? breadcrumb.data.status_code
            : undefined,
      },
    }
  }
  return {
    category: breadcrumb.category,
    level: breadcrumb.level,
    timestamp: breadcrumb.timestamp,
    message: breadcrumb.message ? redactMessage(breadcrumb.message) : undefined,
  }
}

export const errorReportingOptions = {
  sendDefaultPii: false,
  includeLocalVariables: false,
  tracesSampleRate: 0,
  defaultIntegrations: false as const,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
}
