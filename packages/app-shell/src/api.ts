import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import {
  apiErrorResponseSchema,
  createDocumentMetadataRequestSchema,
  createDocumentMetadataResponseSchema,
  createMatterRequestSchema,
  deleteDocumentResponseSchema,
  listMatterDocumentsResponseSchema,
  listMattersResponseSchema,
  matterResponseSchema,
  type CreateDocumentMetadataRequest,
  type CreateMatterRequest,
} from '@ormont/contracts'

const jsonHeaders = {
  'Content-Type': 'application/json',
}

function apiUrl(path: string) {
  const baseUrl = import.meta.env.VITE_ORMONT_API_BASE_URL ?? 'http://localhost:8787'
  return new URL(path, baseUrl).toString()
}

class OrmontApiError extends Error {
  readonly code: string
  readonly requestId: string | null
  readonly status: number

  constructor(input: { code: string; message: string; requestId: string | null; status: number }) {
    super(input.message)
    this.name = 'OrmontApiError'
    this.code = input.code
    this.requestId = input.requestId
    this.status = input.status
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  return text.length > 0 ? JSON.parse(text) : null
}

async function requestApi(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const response = await fetch(input, {
    ...init,
    credentials: 'include',
    headers: {
      ...jsonHeaders,
      ...init?.headers,
    },
  })
  const body = await readJson(response)

  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(body)
    if (parsed.success) {
      throw new OrmontApiError({
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        requestId: parsed.data.error.requestId,
        status: response.status,
      })
    }
    throw new OrmontApiError({
      code: 'unexpected_response',
      message: 'The API returned an unexpected error response.',
      requestId: null,
      status: response.status,
    })
  }

  return body
}

export function formatApiError(error: unknown) {
  if (error instanceof OrmontApiError) {
    const request = error.requestId ? ` Request ${error.requestId}.` : ''
    return `${error.message}${request}`
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'The request failed. Check the API is running and try again.'
}

export function listMattersQueryOptions() {
  return queryOptions({
    queryKey: ['api', 'matters'],
    queryFn: async () => listMattersResponseSchema.parse(await requestApi(apiUrl('/api/matters'))),
  })
}

export function createMatterQueryOptions(matterId: string) {
  return queryOptions({
    queryKey: ['api', 'matters', matterId],
    queryFn: async () =>
      matterResponseSchema.parse(await requestApi(apiUrl(`/api/matters/${matterId}`))),
  })
}

export function listMatterDocumentsQueryOptions(matterId: string) {
  return queryOptions({
    queryKey: ['api', 'matters', matterId, 'documents'],
    queryFn: async () =>
      listMatterDocumentsResponseSchema.parse(
        await requestApi(apiUrl(`/api/matters/${matterId}/documents`)),
      ),
  })
}

export async function invalidateMatterDocuments(queryClient: QueryClient, matterId: string) {
  await queryClient.invalidateQueries({
    queryKey: ['api', 'matters', matterId, 'documents'],
  })
}

export async function createDocumentMetadata(
  matterId: string,
  input: CreateDocumentMetadataRequest,
) {
  return createDocumentMetadataResponseSchema.parse(
    await requestApi(apiUrl(`/api/matters/${matterId}/documents`), {
      body: JSON.stringify(createDocumentMetadataRequestSchema.parse(input)),
      method: 'POST',
    }),
  )
}

export async function deleteDocument(documentId: string) {
  return deleteDocumentResponseSchema.parse(
    await requestApi(apiUrl(`/api/documents/${documentId}`), {
      method: 'DELETE',
    }),
  )
}

export function createMatterMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (input: CreateMatterRequest) =>
      matterResponseSchema.parse(
        await requestApi(apiUrl('/api/matters'), {
          body: JSON.stringify(createMatterRequestSchema.parse(input)),
          method: 'POST',
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['api', 'matters'] })
    },
  })
}

export function createDocumentMetadataMutationOptions(
  queryClient: QueryClient,
  matterId: string,
) {
  return mutationOptions({
    mutationFn: async (input: CreateDocumentMetadataRequest) =>
      createDocumentMetadata(matterId, input),
    onSuccess: async () => invalidateMatterDocuments(queryClient, matterId),
  })
}

export function deleteDocumentMutationOptions(queryClient: QueryClient, matterId: string) {
  return mutationOptions({
    mutationFn: async (documentId: string) => deleteDocument(documentId),
    onSuccess: async () => invalidateMatterDocuments(queryClient, matterId),
  })
}
