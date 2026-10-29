import { parseLegislationActPath } from '@obiter/contracts'
import { z } from 'zod'

export const authorityDocumentIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes(':'), {
    message:
      'A judgment document id cannot contain ":"; it delimits evidence ids.',
  })
export type AuthorityDocumentId = z.infer<typeof authorityDocumentIdSchema>

const LEGISLATION_SEGMENT = /^[A-Za-z0-9._-]+$/

export function isCanonicalLegislationPath(value: string): boolean {
  return value
    .split('/')
    .every(
      (segment) =>
        segment !== '.' &&
        segment !== '..' &&
        LEGISLATION_SEGMENT.test(segment),
    )
}

export const legislationDocumentIdentitySchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      isCanonicalLegislationPath(value) &&
      parseLegislationActPath(`/ln/${value}`)?.documentIdentity === value,
    {
      message:
        'A legislation document identity must be the canonical `ukpga/YYYY/N` form.',
    },
  )
export type LegislationDocumentIdentity = z.infer<
  typeof legislationDocumentIdentitySchema
>

export const legislationLabelPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => isCanonicalLegislationPath(value), {
    message:
      'A legislation label path must be `/`-separated, non-empty, non-traversal canonical segments.',
  })
export type LegislationLabelPath = z.infer<typeof legislationLabelPathSchema>
