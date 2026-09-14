import { z } from 'zod'
import {
  verificationFindingsDefaultLimit,
  verificationFindingsMaxLimit,
  verificationListDefaultLimit,
  verificationListMaxLimit,
} from '@obiter/contracts'

/**
 * Keyset pagination for the verification run and finding lists. A cursor names
 * the last row of the previous page by its `(created_at, id)` key, so a page
 * boundary is stable when several rows share a timestamp and when rows are
 * inserted between requests. It is opaque to the client: base64url of a strict
 * JSON object, rejected whole if it does not decode.
 */
const cursorPayloadSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().min(1),
  })
  .strict()

export type VerificationPageCursor = z.infer<typeof cursorPayloadSchema>

export function encodeVerificationCursor(
  cursor: VerificationPageCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeVerificationCursor(
  raw: string,
): VerificationPageCursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    const parsed = cursorPayloadSchema.safeParse(JSON.parse(decoded))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The cursor a caller sends to fetch the page after `row`. `cursor_created_at`
 * is the database's full-precision UTC text for the row timestamp; an ISO
 * millisecond round-trip would drop microseconds and repeat a row across a page
 * boundary. */
export function cursorFromRow(row: {
  cursor_created_at: string
  id: string
}): VerificationPageCursor {
  return { createdAt: row.cursor_created_at, id: row.id }
}

/** The cursor a caller sends to fetch the page after `row`, ordered by
 * `(created_at, finding_id)`. */
export function findingCursorFromRow(row: {
  cursor_created_at: string
  finding_id: string
}): VerificationPageCursor {
  return { createdAt: row.cursor_created_at, id: row.finding_id }
}

/**
 * A requested limit is validated, not trusted: anything outside `1..max` is a
 * caller error the route answers with 400, and the default is used when the
 * parameter is absent. The store still issues `limit + 1` rows so it can tell
 * "exactly a page" from "there is a next page" without a count query.
 */
export function resolveRunListLimit(requested: number | undefined) {
  return resolveLimit(
    requested,
    verificationListDefaultLimit,
    verificationListMaxLimit,
  )
}

export function resolveFindingsListLimit(requested: number | undefined) {
  return resolveLimit(
    requested,
    verificationFindingsDefaultLimit,
    verificationFindingsMaxLimit,
  )
}

function resolveLimit(
  requested: number | undefined,
  fallback: number,
  max: number,
): number {
  if (requested === undefined) return fallback
  if (!Number.isInteger(requested) || requested < 1 || requested > max) {
    throw new VerificationListLimitError(max)
  }
  return requested
}

export class VerificationListLimitError extends Error {
  constructor(max: number) {
    super(`A page limit must be a whole number between 1 and ${max}.`)
    this.name = 'VerificationListLimitError'
  }
}

export function parseRunListLimit(raw: string | undefined) {
  if (raw === undefined || raw === '') return undefined
  return Number(raw)
}
