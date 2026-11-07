import {
  init,
  globalHandlersIntegration,
  breadcrumbsIntegration,
  type BrowserOptions,
} from '@sentry/react'
import { scrubEvent } from '@obiter/config/error-reporting'
import { reportingUser } from './error-reporting-user'

export function initialize(options: BrowserOptions) {
  init({
    ...options,
    integrations: [
      globalHandlersIntegration(),
      breadcrumbsIntegration({
        dom: false,
        fetch: true,
        history: true,
        xhr: true,
      }),
    ],
    beforeSend: (event) =>
      scrubEvent({
        ...event,
        request: event.request ?? { url: window.location.href },
        user: { ...reportingUser() },
      }),
  })
}
