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
  return process.env.ORMONT_API_ORIGIN ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:8787'
}

export const authClient = createAuthClient({
  baseURL: authBaseURL(),
  plugins: [magicLinkClient()],
})

export interface SignInEmailInput {
  email: string
  password: string
}

export interface UseAuthReturn {
  session: typeof authClient.$Infer.Session | null
  isPending: boolean
  signInWithEmail: (input: SignInEmailInput) => Promise<{ ok: boolean; message?: string }>
  requestMagicLink: (email: string) => Promise<{ ok: boolean; message?: string }>
  signOut: () => Promise<void>
}

/**
 * useAuth — the shell's auth surface. Wraps the better-auth React client so
 * feature UIs never call better-auth directly.
 */
export function useAuth(): UseAuthReturn {
  const session = authClient.useSession()

  async function signInWithEmail(input: SignInEmailInput) {
    const result = await authClient.signIn.email(input)
    if (result.error) {
      return { ok: false, message: result.error.message ?? 'Sign-in failed.' }
    }
    return { ok: true }
  }

  async function requestMagicLink(email: string) {
    const result = await authClient.signIn.magicLink({ email })
    if (result.error) {
      return { ok: false, message: result.error.message ?? 'Could not send magic link.' }
    }
    return { ok: true, message: 'Check your email for a sign-in link.' }
  }

  async function signOut() {
    await authClient.signOut()
  }

  return {
    session: session.data,
    isPending: session.isPending,
    signInWithEmail,
    requestMagicLink,
    signOut,
  }
}
