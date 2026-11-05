import { Navigate, useSearch } from '@tanstack/react-router'
import type { AppPlatform } from '@obiter/contracts'

export function SignUpRedirectView({ platform }: { platform: AppPlatform }) {
  // SAFETY: useSearch with strict:false is untyped; token is re-validated as a non-empty string below.
  const search = useSearch({ strict: false }) as { token?: string }
  const token =
    typeof search.token === 'string' && search.token.length > 0
      ? search.token
      : ''

  return token ? (
    <Navigate to="/invites/accept" search={{ token }} replace />
  ) : (
    <Navigate
      to={platform === 'web' ? '/request-access' : '/sign-in'}
      replace
    />
  )
}
