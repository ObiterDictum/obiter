/**
 * The callback URL better-auth should return an invited user to after an
 * out-of-band step (verification, magic link). Guarded for SSR: three callers
 * evaluate this during render, and this app server-renders, so an unguarded
 * `window` would 500 the page rather than fall back.
 */
export function inviteAcceptCallbackURL(token: string): string | undefined {
  if (!token || typeof window === 'undefined') return undefined
  return `${window.location.origin}/invites/accept?token=${encodeURIComponent(token)}`
}
