import { errorReportingOptions } from '@obiter/config/error-reporting'

export async function startErrorReporting(
  dsn: string | undefined,
  release: string | undefined,
  production: boolean,
) {
  if (!dsn) return
  const { initialize } = await import('./error-reporting-sdk')
  initialize({
    ...errorReportingOptions,
    dsn,
    release,
    environment: production ? 'production' : 'development',
  })
}
