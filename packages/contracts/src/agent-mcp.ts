import { z } from 'zod'
import { secureHttpsUrlSchema } from './agent-secure-url'

const id = z.string().min(1)
const timestamp = z.string().datetime({ offset: true })
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const endpoint = secureHttpsUrlSchema
const secret = z
  .string()
  .min(1)
  .max(4096)
  .regex(
    /^[\x21-\x7e\x80-\xff](?:[\x20-\x7e\x80-\xff\t]*[\x21-\x7e\x80-\xff])?$/u,
  )
const header = z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)

export const mcpAuthKindSchema = z.enum(['none', 'bearer', 'custom_header'])
export type McpAuthKind = z.infer<typeof mcpAuthKindSchema>
export const mcpWritePolicySchema = z.enum(['supervised', 'read_only_trusted'])
export type McpWritePolicy = z.infer<typeof mcpWritePolicySchema>

const serverFields = {
  slug,
  transport: z.enum(['http', 'desktop_stdio']),
  endpointUrl: endpoint.nullable(),
  authKind: mcpAuthKindSchema,
  authHeaderName: header.nullable(),
  allowMatterData: z.boolean(),
  writePolicy: mcpWritePolicySchema,
  enabled: z.boolean(),
}

function validServer(value: {
  transport: string
  endpointUrl: string | null
  authKind: string
  authHeaderName: string | null
}) {
  return (
    (value.transport === 'http'
      ? value.endpointUrl !== null
      : value.endpointUrl === null) &&
    (value.authKind === 'custom_header'
      ? value.authHeaderName !== null
      : value.authHeaderName === null)
  )
}

export const organisationMcpServerSchema = z
  .object({
    id,
    ...serverFields,
    hasSecret: z.boolean(),
    updatedAt: timestamp,
  })
  .strict()
  .refine(validServer, 'Transport and authentication settings must match.')
export type OrganisationMcpServer = z.infer<typeof organisationMcpServerSchema>

export const organisationMcpServerCreateRequestSchema = z
  .object({
    ...serverFields,
    secret: secret.optional(),
  })
  .strict()
  .refine(validServer, 'Transport and authentication settings must match.')
  .refine(
    (value) => value.authKind !== 'none' || value.secret === undefined,
    'Unauthenticated servers cannot have a secret.',
  )
export type OrganisationMcpServerCreateRequest = z.infer<
  typeof organisationMcpServerCreateRequestSchema
>

export const organisationMcpServerUpdateRequestSchema = z
  .object({
    ...serverFields,
    secret: secret.nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to change.')
  .refine(
    (value) =>
      value.transport === undefined ||
      value.endpointUrl === undefined ||
      (value.transport === 'http'
        ? value.endpointUrl !== null
        : value.endpointUrl === null),
    'Transport and endpoint must match.',
  )
  .refine(
    (value) =>
      value.authKind === undefined ||
      value.authHeaderName === undefined ||
      (value.authKind === 'custom_header'
        ? value.authHeaderName !== null
        : value.authHeaderName === null),
    'Authentication and header must match.',
  )
  .refine(
    (value) => value.authKind !== 'none' || value.secret == null,
    'Unauthenticated servers cannot have a secret.',
  )
export type OrganisationMcpServerUpdateRequest = z.infer<
  typeof organisationMcpServerUpdateRequestSchema
>

export const organisationMcpServerListResponseSchema = z
  .object({ servers: z.array(organisationMcpServerSchema) })
  .strict()
export type OrganisationMcpServerListResponse = z.infer<
  typeof organisationMcpServerListResponseSchema
>
export const organisationMcpServerResponseSchema = z
  .object({ server: organisationMcpServerSchema })
  .strict()
export type OrganisationMcpServerResponse = z.infer<
  typeof organisationMcpServerResponseSchema
>
export const mcpConnectionCheckResponseSchema = z
  .object({ ok: z.boolean(), message: z.string().min(1) })
  .strict()
export type McpConnectionCheckResponse = z.infer<
  typeof mcpConnectionCheckResponseSchema
>
