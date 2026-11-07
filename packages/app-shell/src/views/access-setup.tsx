import { useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { accessSetupResponseSchema } from '@obiter/contracts'
import { apiFetch } from '../api'
import { AccountSetupForm } from './account-setup-form'
import { AuthHeading, AuthLayout } from './auth-layout'

export function AccessSetupRouteView() {
  const search = useSearch({ strict: false })
  const token =
    'token' in search && typeof search.token === 'string' ? search.token : ''
  const setup = useQuery({
    queryKey: ['access-setup', token],
    queryFn: async () =>
      accessSetupResponseSchema.parse(
        await apiFetch('/api/access-requests/setup', {
          method: 'POST',
          body: JSON.stringify({ token }),
        }),
      ),
    enabled: !!token && typeof window !== 'undefined',
    retry: false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  return (
    <AuthLayout footnote="Need help? Reply to your approval email.">
      <AuthHeading
        title="Set up your account"
        description="Create your Obiter account with your approved email address."
      />
      {setup.data?.status === 'verified' ? (
        <AccountSetupForm approvedEmail={setup.data.email} />
      ) : (
        <p role="status">
          {setup.isPending && token
            ? 'Checking your setup link…'
            : 'This link is invalid, expired or already used. Request a new access link.'}
        </p>
      )}
    </AuthLayout>
  )
}
