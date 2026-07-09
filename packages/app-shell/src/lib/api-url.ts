/**
 * Resolve an API path for the current runtime.
 *
 * In the browser the Vite dev-server proxy (and same-origin in production) makes
 * `/api/...` correct. On the server (TanStack Start SSR) the API lives at
 * OBITER_API_ORIGIN (falling back to BETTER_AUTH_URL, then the dev API port).
 */
export function apiUrl(path: string): string {
  if (typeof window !== 'undefined') {
    return path
  }

  return new URL(
    path,
    process.env.OBITER_API_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:8787',
  ).toString()
}
