import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'
import { createDevSession, DEV_AUTO_LOGIN } from './dev-session'

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

/**
 * When dev auto-login is enabled, the shell presents a synthetic session and
 * never touches better-auth. Vite strips this branch in production builds.
 */

export interface SignInEmailInput {
  email: string
  password: string
}

export interface UseAuthReturn {
  /**
   * Present when the user has a real better-auth session, or (in dev only) a
   * synthetic session. The shell reads presence only; user/org data comes from
   * `/api/me` via `useCurrentUser`, not this field.
   */
  session: AuthSessionPresence | null
  isPending: boolean
  signInWithEmail: (input: SignInEmailInput) => Promise<{ ok: boolean; message?: string }>
  requestMagicLink: (email: string) => Promise<{ ok: boolean; message?: string }>
  signOut: () => Promise<void>
}

/**
 * Structural session type. The real better-auth session and the dev synthetic
 * session both satisfy it; the shell only checks presence.
 */
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

  // Dev auto-login: present a synthetic, never-pending session so the frame's
  // auth gate admits the user without a real better-auth round-trip.
  const session = DEV_AUTO_LOGIN ? createDevSession() : realSession.data
  const isPending = DEV_AUTO_LOGIN ? false : realSession.isPending

  async function signInWithEmail(input: SignInEmailInput) {
    if (DEV_AUTO_LOGIN) {
      return { ok: true }
    }
    const result = await authClient.signIn.email(input)
    if (result.error) {
      return { ok: false, message: result.error.message ?? 'Sign-in failed.' }
    }
    return { ok: true }
  }

  async function requestMagicLink(email: string) {
    if (DEV_AUTO_LOGIN) {
      return { ok: true, message: 'Dev auto-login is enabled.' }
    }
    const result = await authClient.signIn.magicLink({ email })
    if (result.error) {
      return { ok: false, message: result.error.message ?? 'Could not send magic link.' }
    }
    return { ok: true, message: 'Check your email for a sign-in link.' }
  }

  async function signOut() {
    if (DEV_AUTO_LOGIN) {
      return
    }
    await authClient.signOut()
  }

  return {
    session,
    isPending,
    signInWithEmail,
    requestMagicLink,
    signOut,
  }
}
