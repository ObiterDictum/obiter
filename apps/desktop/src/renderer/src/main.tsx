import { ErrorReportingBoundary } from '@obiter/app-shell'
import { startErrorReporting } from '@obiter/app-shell/error-reporting'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import ReactDOM from 'react-dom/client'
import { createAppRouter } from './router'
import './styles.css'

startErrorReporting('desktop',__OBITER_BUILD_COMMIT__,import.meta.env.PROD)

const queryClient = new QueryClient()
const router = createAppRouter(queryClient)
const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Desktop renderer root element was not found.')
}

ReactDOM.createRoot(rootElement).render(
  <QueryClientProvider client={queryClient}>
    <ErrorReportingBoundary><RouterProvider router={router} /></ErrorReportingBoundary>
  </QueryClientProvider>,
)
