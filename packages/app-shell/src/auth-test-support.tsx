import { mock as bunMock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const mock = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signOutFn: vi.fn(),
  sendVerificationEmail: vi.fn(),
  useSession: vi.fn(),
  refetch: vi.fn(),
  verifyTotp: vi.fn(),
  verifyBackupCode: vi.fn(),
}))

bunMock.module('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mock.useSession,
    signIn: { email: mock.signInEmail },
    signOut: mock.signOutFn,
    sendVerificationEmail: mock.sendVerificationEmail,
    twoFactor: {
      verifyTotp: mock.verifyTotp,
      verifyBackupCode: mock.verifyBackupCode,
    },
  }),
}))

bunMock.module('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({}),
  twoFactorClient: () => ({}),
}))

export const {
  signInEmail,
  signOutFn,
  sendVerificationEmail,
  useSession,
  refetch,
  verifyTotp,
  verifyBackupCode,
} = mock

export const { useAuth } = await import('./auth')

export function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}
