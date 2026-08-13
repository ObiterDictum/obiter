import JSZip from 'jszip'

const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
}

export function isPackageImagePartName(partName: string) {
  return requestedImagePartName(partName) !== undefined
}

export function requestedImagePartName(partName: string) {
  const name = normaliseRequestedPart(partName)
  return imageContentType(name) ? name : undefined
}

export async function readPackageImageParts(input: Uint8Array) {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    return new Map<string, { bytes: Uint8Array; contentType: string }>()
  }

  const parts = new Map<string, { bytes: Uint8Array; contentType: string }>()
  for (const [rawName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const name = normaliseRequestedPart(rawName)
    const contentType = imageContentType(name)
    if (!name || !contentType) continue
    parts.set(name, { bytes: await entry.async('uint8array'), contentType })
  }
  return parts
}

function imageContentType(partName: string | undefined) {
  if (!partName) return undefined
  const extension = partName.slice(partName.lastIndexOf('.') + 1).toLowerCase()
  return IMAGE_CONTENT_TYPES[extension]
}

function normaliseRequestedPart(value: string) {
  if (!value || value.includes('\0')) return undefined
  const parts: string[] = []
  for (const part of value.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..' || !/^[A-Za-z0-9._-]+$/.test(part)) return undefined
    parts.push(part)
  }
  return parts.length > 0 ? parts.join('/') : undefined
}
