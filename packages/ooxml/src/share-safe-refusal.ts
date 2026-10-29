export type ShareSafeRefusalReason =
  | 'tracked-changes'
  | 'hidden-content'
  | 'external-reference'
  | 'opaque-payload'
  | 'unsupported-structure'
  | 'malformed-package'
  | 'oversized-structure'
  | 'unverifiable-output'

export class ShareSafeRefusal extends Error {
  readonly reason: ShareSafeRefusalReason

  constructor(reason: ShareSafeRefusalReason, detail: string) {
    super(detail)
    this.name = 'ShareSafeRefusal'
    this.reason = reason
  }
}

export function refuseShareSafe(
  reason: ShareSafeRefusalReason,
  detail: string,
): never {
  throw new ShareSafeRefusal(reason, detail)
}
