import { describe, expect, it } from 'bun:test'
import {
  organisationMcpServerCreateRequestSchema,
  organisationMcpServerResponseSchema,
  organisationMcpServerSchema,
  organisationMcpServerUpdateRequestSchema,
} from './agent-mcp'

const timestamp = '2026-11-04T09:30:00.000Z'

const server = {
  slug: 'research',
  transport: 'http',
  endpointUrl: 'https://tools.example/mcp',
  authKind: 'none',
  authHeaderName: null,
  allowMatterData: false,
  writePolicy: 'supervised',
  enabled: true,
}

const responseServer = {
  ...server,
  id: 'mcp_1',
  hasSecret: false,
  updatedAt: timestamp,
}

describe('MCP endpoint URLs', () => {
  it('rejects embedded credentials and raw control characters on create', () => {
    for (const endpointUrl of [
      'https://user:pass@tools.example/mcp',
      'https://tools.example/mcp\rpath',
      'https://tools.example/mcp\npath',
      'https://tools.example/mcp\tpath',
      'https://tools.example/mcp\u0085path',
    ]) {
      expect(
        organisationMcpServerCreateRequestSchema.safeParse({
          ...server,
          endpointUrl,
        }).success,
      ).toBe(false)
    }
    expect(
      organisationMcpServerCreateRequestSchema.safeParse(server).success,
    ).toBe(true)
  })

  it('rejects embedded credentials and raw control characters on update', () => {
    for (const endpointUrl of [
      'https://user:pass@tools.example/mcp',
      'https://tools.example/mcp\rpath',
      'https://tools.example/mcp\npath',
      'https://tools.example/mcp\tpath',
    ]) {
      expect(
        organisationMcpServerUpdateRequestSchema.safeParse({
          endpointUrl,
        }).success,
      ).toBe(false)
    }
    expect(
      organisationMcpServerUpdateRequestSchema.safeParse({
        endpointUrl: 'https://tools.example/updated',
      }).success,
    ).toBe(true)
  })

  it('rejects embedded credentials and raw control characters in responses', () => {
    for (const endpointUrl of [
      'https://user:pass@tools.example/mcp',
      'https://tools.example/mcp\rpath',
      'https://tools.example/mcp\npath',
      'https://tools.example/mcp\tpath',
    ]) {
      expect(
        organisationMcpServerSchema.safeParse({
          ...responseServer,
          endpointUrl,
        }).success,
      ).toBe(false)
      expect(
        organisationMcpServerResponseSchema.safeParse({
          server: { ...responseServer, endpointUrl },
        }).success,
      ).toBe(false)
    }
    expect(organisationMcpServerSchema.safeParse(responseServer).success).toBe(
      true,
    )
  })
})

describe('MCP secrets used as HTTP header values', () => {
  it('accepts only secrets that construct a header without changing value edges', () => {
    for (const value of [
      'token-1234567890',
      'two words 123456',
      'tab\tinside-value',
    ]) {
      const parsed = organisationMcpServerCreateRequestSchema.parse({
        ...server,
        authKind: 'bearer',
        secret: value,
      })
      expect(
        new Headers({ Authorization: parsed.secret ?? '' }).get(
          'Authorization',
        ),
      ).toBe(value)
      const updated = organisationMcpServerUpdateRequestSchema.parse({
        secret: value,
      })
      expect(
        new Headers({ Authorization: updated.secret ?? '' }).get(
          'Authorization',
        ),
      ).toBe(value)
    }
  })

  it('rejects controls, edge whitespace, and Unicode outside the ByteString range', () => {
    for (const secret of [
      ' leading-secret-value',
      'trailing-secret-value ',
      '\tleading-tab-secret',
      'trailing-tab-secret\t',
      'secret\rwith-cr',
      'secret\nwith-lf',
      'secret\u0000with-nul',
      'secret\u0001with-control',
      'secret\u007fwith-delete',
      'secret\u0100with-unicode',
      'secret-😀-value',
    ]) {
      expect(
        organisationMcpServerCreateRequestSchema.safeParse({
          ...server,
          authKind: 'bearer',
          secret,
        }).success,
      ).toBe(false)
      expect(
        organisationMcpServerUpdateRequestSchema.safeParse({ secret }).success,
      ).toBe(false)
    }
  })
})

describe('MCP partial update invariants', () => {
  it('rejects locally contradictory transport, endpoint, and authentication fields', () => {
    for (const patch of [
      { transport: 'desktop_stdio', endpointUrl: 'https://tools.example' },
      { transport: 'http', endpointUrl: null },
      { authKind: 'custom_header', authHeaderName: null },
      { authKind: 'bearer', authHeaderName: 'X-Token' },
      { authKind: 'none', authHeaderName: 'X-Token' },
      { authKind: 'none', secret: 'token-1234567890' },
    ]) {
      expect(
        organisationMcpServerUpdateRequestSchema.safeParse(patch).success,
      ).toBe(false)
    }
  })

  it('accepts valid partial updates when the other invariant field is omitted', () => {
    for (const patch of [
      { transport: 'desktop_stdio' },
      { endpointUrl: null },
      { authKind: 'bearer' },
      { authHeaderName: null },
      { secret: 'token-1234567890' },
    ]) {
      expect(
        organisationMcpServerUpdateRequestSchema.safeParse(patch).success,
      ).toBe(true)
    }
  })
})
