import { z } from 'zod'
import {
  verificationFindingsDefaultLimit,
  verificationFindingsMaxLimit,
  verificationListDefaultLimit,
  verificationListMaxLimit,
} from '@obiter/contracts'

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

export function cursorFromRow(row: {
  cursor_created_at: string
  id: string
}): VerificationPageCursor {
  return { createdAt: row.cursor_created_at, id: row.id }
}

export function findingCursorFromRow(row: {
  cursor_created_at: string
  finding_id: string
}): VerificationPageCursor {
  return { createdAt: row.cursor_created_at, id: row.finding_id }
}

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
