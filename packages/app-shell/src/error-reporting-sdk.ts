import {
  init,
  globalHandlersIntegration,
  type BrowserOptions,
} from '@sentry/react'

export function initialize(options: BrowserOptions) {
  init({ ...options, integrations: [globalHandlersIntegration()] })
}
