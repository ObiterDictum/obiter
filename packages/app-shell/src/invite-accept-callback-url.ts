export function inviteAcceptCallbackURL(token: string): string | undefined {
  if (!token || typeof window === 'undefined') return undefined
  return `${window.location.origin}/invites/accept?token=${encodeURIComponent(token)}`
}
