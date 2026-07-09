import { createDemoMeResponse } from './fixtures'

/**
 * Dev-only auto-login. Bypasses the real better-auth sign-in so local
 * development is not blocked on pre-provisioned database credentials.
 *
 * This is a clearly named demo path (see RULES.md "Code Rules"). It is ON by
 * default in dev (`import.meta.env.DEV`) because no seeded users exist yet —
 * real sign-in cannot succeed against an unmigrated database. Set
 * `VITE_DEV_AUTO_LOGIN=0` to opt out and exercise the REAL auth path locally
 * (needed for the sign-in round-trip verification once `pnpm seed` lands).
 *
 * DEV_AUTO_LOGIN is a top-level const (not a function) deliberately: Vite
 * inlines `import.meta.env.DEV` as `false` in production builds, the minifier
 * folds `false && …` to `false`, and every `if (DEV_AUTO_LOGIN)` branch is
 * eliminated from shipped bundles. A function-call gate defeats that folding
 * and ships the (inert) code — verified against the built bundle.
 *
 * Dies with fixtures.ts when `pnpm seed` lands (M2): seeded credentials
 * replace the need for a synthetic session.
 */

export const DEV_AUTO_LOGIN: boolean =
  import.meta.env.DEV && import.meta.env.VITE_DEV_AUTO_LOGIN !== '0'

/**
 * Minimal session shape the shell reads (frame gate + current-user fallback).
 * In dev auto-login the shell never calls better-auth, so the full session type
 * is not required.
 */
export interface DevSession {
  user: { id: string; email: string; name: string }
  session: { id: string }
}

export function createDevSession(): DevSession {
  const me = createDemoMeResponse()
  return {
    user: me.user,
    session: { id: 'dev-session' },
  }
}
