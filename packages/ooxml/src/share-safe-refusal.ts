export type ShareSafeRefusalReason =
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
  /** A part whose element or attribute count exceeds the share-safe shape
   * caps: valid OOXML, but a shape whose super-linear passes this layer
   * refuses to run. */
  | 'oversized-structure'
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
