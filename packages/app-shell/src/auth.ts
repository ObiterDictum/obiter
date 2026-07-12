import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Better-auth client for the browser. The API mounts better-auth at /api/auth/*
 * with email/password and magic-link enabled (services/api/src/auth.ts). In dev
 * the Vite proxy forwards /api to the API; in production it is same-origin.
 */
function authBaseURL(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return process.env.OBITER_API_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:8787'
}

export const authClient = createAuthClient({
  baseURL: authBaseURL(),
  plugins: [magicLinkClient()],
})

export interface SignInEmailInput {
  email: string
  password: string
}

export interface SignUpEmailInput {
  name: string
  email: string
  password: string
}

export interface UseAuthReturn {
  /** Present when better-auth has established a real session. */
  session: AuthSessionPresence | null
  isPending: boolean
  signInWithEmail: (input: SignInEmailInput) => Promise<{ ok: boolean; message?: string }>
  signUpWithEmail: (
    input: SignUpEmailInput,
  ) => Promise<{ ok: boolean; message?: string; verificationRequired?: boolean }>
  requestMagicLink: (email: string) => Promise<{ ok: boolean; message?: string }>
  requestPasswordReset: (
    email: string,
  ) => Promise<{ ok: boolean; message?: string }>
  resetPassword: (
    token: string,
    newPassword: string,
  ) => Promise<{ ok: boolean; message?: string; code?: string }>
  signOut: () => Promise<void>
}

/** Structural session type; the shell only checks presence. */
interface AuthSessionPresence {
  user: { id: string }
  session: { id: string }
}

/**
 * useAuth — the shell's auth surface. Wraps the better-auth React client so
 * feature UIs never call better-auth directly.
 */
export function useAuth(): UseAuthReturn {
  const realSession = authClient.useSession()
  const queryClient = useQueryClient()

  /**
   * After a successful credential exchange the HTTP session cookie exists, but
   * `useSession()` may still report null until its store is refetched. The
   * desktop shell navigates client-side (no full reload), so AppShellLayout
   * would bounce back to /sign-in and remount an empty form. Web avoids this
   * via window.location.assign; desktop must refetch before navigate.
   */
  async function refreshSessionAfterAuth() {
    await realSession.refetch()
  }

  async function signInWithEmail(input: SignInEmailInput) {
    const result = await authClient.signIn.email(input)
    if (result.error) {
      return { ok: false, message: result.error.message ?? 'Sign-in failed.' }
    }
    await refreshSessionAfterAuth()
    return { ok: true }
  }

  async function signUpWithEmail(input: SignUpEmailInput) {
    const result = await authClient.signUp.email(input)
    if (result.error) {
      return { ok: false, message: result.error.message ?? 'Sign-up failed.' }
    }
    // With requireEmailVerification enabled, sign-up does not establish a
    // session — better-auth returns { token: null, user } and sends a
    // verification email instead. No session means no auto sign-in yet.
    if (!result.data?.token) {
      return {
        ok: true,
        verificationRequired: true,
        message: 'Check your email to verify your account before signing in.',
      }
    }
    await refreshSessionAfterAuth()
    return { ok: true }
  }

  async function requestMagicLink(email: string) {
    const callbackURL = typeof window === 'undefined'
      ? undefined
      : `${window.location.origin}/`
    const result = await authClient.signIn.magicLink({ email, callbackURL })
    if (result.error) {
      return { ok: false, message: result.error.message ?? 'Could not send magic link.' }
    }
    return { ok: true, message: 'Check your email for a sign-in link.' }
  }

  async function signOut() {
    await authClient.signOut()
    // Drop cached /api/me (and org-scoped data) so a subsequent sign-in as a
    // different user never gates routes on the previous user's organisation
    // state. The current-user query has a 60s staleTime, so without this a
    // fresh sign-in could read a stale org-less/owning entry.
    queryClient.clear()
  }

  // better-auth 1.6.x password reset: POST /request-password-reset never
  // reveals whether the email exists (it returns the same message and runs a
  // timing-attack mitigation). The reset link is derived server-side from the
  // token and always points at the configured web origin (OBITER_WEB_ORIGIN),
  // so the client does not — and must not — pass a redirectTo. Under the
  // desktop renderer the window origin is a custom scheme, which better-auth
  // would reject and which could not open in a browser anyway.
  async function requestPasswordReset(email: string) {
    const result = await authClient.requestPasswordReset({ email })
    if (result.error) {
      return { ok: false, message: result.error.message ?? 'Could not send a reset link.' }
    }
    return {
      ok: true,
      message:
        'If an account exists for that email, we have sent a link to reset your password.',
    }
  }

  async function resetPassword(token: string, newPassword: string) {
    const result = await authClient.resetPassword({ token, newPassword })
    if (result.error) {
      // Surface better-auth's error code (e.g. INVALID_TOKEN,
      // PASSWORD_TOO_LONG) so the reset screen can distinguish a dead token
      // from a retryable validation/server failure.
      return {
        ok: false,
        message: result.error.message ?? 'Could not reset your password.',
        code: typeof result.error.code === 'string' ? result.error.code : undefined,
      }
    }
    return { ok: true }
  }

  return {
    session: realSession.data,
    isPending: realSession.isPending,
    signInWithEmail,
    signUpWithEmail,
    requestMagicLink,
    requestPasswordReset,
    resetPassword,
    signOut,
  }
}
