/**
 * Raised when a package cannot be proven free of private or ambiguous
 * material for sharing. The route maps it to `share_safe_export_refused`;
 * nothing is emitted in that case.
 *
 * `reason` is the structured class a caller may log: a bounded enum, so
 * telemetry carries the policy clause that failed and never a part name,
 * attribute value or document text. `message` stays a free-text diagnostic
 * for developers and is never logged or returned to the client.
 */
export type ShareSafeRefusalReason =
  /** Tracked-change or revision markup — deleted text stays recoverable. */
  | 'tracked-changes'
  /** Content hidden by vanish, row marks, drawing flags or VML. */
  | 'hidden-content'
  /** A pointer outside the package: external relationship, detached
   * relationship used through the wrong element, field instruction that
   * fetches, frameset. */
  | 'external-reference'
  /** Content this layer cannot inspect: OLE, ActiveX, altChunk, field data,
   * embedded binary blobs, payload fields. */
  | 'opaque-payload'
  /** Declared structure outside the allow-list: unknown part class, foreign
   * element namespace, a root that does not match the part's role, an
   * unproven field name. */
  | 'unsupported-structure'
  /** Input that cannot be read unambiguously: unparseable XML, non-UTF-8
   * parts, case-variant part names, dangling or duplicated declarations. */
  | 'malformed-package'
  /** The sanitised output failed the independent verification pass. */
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
