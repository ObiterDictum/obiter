import { useEffect, useRef } from 'react'
import { useQueries } from '@tanstack/react-query'
import { apiFetchBlob, apiFetchBlobResult } from './api'
import { versionQuery, workspaceKeys } from './document-workspace-queries'

export function useDocumentImageUrls(
  documentId: string,
  partNames: string[],
  versionId?: string,
) {
  const queries = useQueries({
    queries: partNames.map((partName) => ({
      queryKey: [...workspaceKeys.media(documentId, versionId), partName],
      queryFn: () => loadDocumentImage(documentId, partName, versionId),
      gcTime: 0,
    })),
  })
  const urls: Record<string, string> = {}
  partNames.forEach((partName, index) => {
    const url = queries[index]?.data
    if (url) urls[partName] = url
  })
  const held = useRef<Record<string, string>>({})
  const signature = partNames
    .map((partName) => `${partName}=${urls[partName] ?? ''}`)
    .join('|')
  useEffect(() => {
    const next = { ...urls }
    for (const [partName, url] of Object.entries(held.current)) {
      if (next[partName] !== url) URL.revokeObjectURL(url)
    }
    held.current = next
  }, [signature])
  useEffect(() => {
    return () => {
      for (const url of Object.values(held.current)) URL.revokeObjectURL(url)
      held.current = {}
    }
  }, [documentId])
  return urls
}

const BROWSER_IMAGE = /^image\/(png|jpeg|gif|bmp|webp|svg\+xml)$/

async function loadDocumentImage(
  documentId: string,
  partName: string,
  versionId?: string,
) {
  const search = `?part=${encodeURIComponent(partName)}${
    versionId === undefined ? '' : `&versionId=${encodeURIComponent(versionId)}`
  }`
  const blob = await apiFetchBlob(`/api/documents/${documentId}/media${search}`)
  if (!BROWSER_IMAGE.test(blob.type)) return null
  return URL.createObjectURL(blob)
}

export async function fetchDocumentExport(
  documentId: string,
  options?: { versionId?: string; shareSafe?: boolean },
): Promise<{
  blob: Blob
  skippedCommentCount: number
  filename: string | null
}> {
  const params = new URLSearchParams()
  if (options?.versionId !== undefined)
    params.set('versionId', options.versionId)
  if (options?.shareSafe === true) params.set('mode', 'share-safe')
  const search = params.size === 0 ? '' : `?${params.toString()}`
  const { blob, headers } = await apiFetchBlobResult(
    `/api/documents/${documentId}/export${search}`,
  )
  const skipped = Number(headers.get('x-obiter-comments-skipped') ?? '0')
  return {
    blob,
    skippedCommentCount: Number.isFinite(skipped) ? skipped : 0,
    filename: contentDispositionFilename(headers),
  }
}

export function contentDispositionFilename(headers: Headers): string | null {
  const value = headers.get('content-disposition')
  if (!value) return null
  const encoded = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(value)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1] ?? '')
    } catch {
      return null
    }
  }
  const quoted = /filename="((?:[^"\\]|\\.)*)"/.exec(value)
  if (quoted) return (quoted[1] ?? '').replace(/\\(.)/g, '$1')
  const bare = /filename=([^;]+)/.exec(value)
  return bare?.[1]?.trim() || null
}

export async function fetchDocumentDownload(
  documentId: string,
  versionId?: string,
): Promise<Blob> {
  return apiFetchBlob(
    `/api/documents/${documentId}/download${versionQuery(versionId)}`,
  )
}
