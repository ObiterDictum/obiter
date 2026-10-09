/**
 * Raised when a package cannot be proven free of private or ambiguous
 * material for sharing. The route maps it to `share_safe_export_refused`;
 * nothing is emitted in that case.
 */
export class ShareSafeRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareSafeRefusal'
  }
}

export function refuseShareSafe(reason: string): never {
  throw new ShareSafeRefusal(reason)
}
