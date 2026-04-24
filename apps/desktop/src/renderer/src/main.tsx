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
