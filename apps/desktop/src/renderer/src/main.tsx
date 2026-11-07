import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import ReactDOM from 'react-dom/client'
import { createAppRouter } from './router'
import './styles.css'

const queryClient = new QueryClient()
const router = createAppRouter(queryClient)
const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Desktop renderer root element was not found.')
}

ReactDOM.createRoot(rootElement).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
)

requestAnimationFrame(() => {
  setTimeout(() => {
    const config: unknown = window.obiterDesktop?.errorReporting
    if (
      typeof config !== 'object' ||
      config === null ||
      !('dsn' in config) ||
      typeof config.dsn !== 'string' ||
      !config.dsn
    )
      return
    const dsn = config.dsn
    const release =
      'release' in config && typeof config.release === 'string'
        ? config.release
        : undefined
    void import('@obiter/app-shell/error-reporting').then(
      ({ startErrorReporting }) =>
        startErrorReporting(
          dsn,
          release,
          'production' in config && config.production === true,
        ),
    )
  }, 0)
})

const desktop = window.obiterDesktop
desktop?.onMainError?.(() => {
  window.dispatchEvent(
    new ErrorEvent('error', { message: 'Desktop main process error' }),
  )
})
