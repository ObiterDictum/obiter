import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'

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

  async function signInWithEmail(input: SignInEmailInput) {
    const result = await authClient.signIn.email(input)
    if (result.error) {
      return { ok: false, message: result.error.message ?? 'Sign-in failed.' }
    }
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
  }

  return {
    session: realSession.data,
    isPending: realSession.isPending,
    signInWithEmail,
    signUpWithEmail,
    requestMagicLink,
    signOut,
  }
}
