export function inviteAcceptCallbackURL(token: string): string | undefined {
  return token
    ? `${window.location.origin}/invites/accept?token=${encodeURIComponent(token)}`
    : undefined
}
