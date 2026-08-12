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
  return imageContentType(normaliseRequestedPart(partName)) !== undefined
}

export async function readPackageImagePart(
  input: Uint8Array,
  partName: string,
) {
  const name = normaliseRequestedPart(partName)
  const contentType = imageContentType(name)
  if (!name || !contentType) return undefined

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    return undefined
  }

  const entry = zip.file(name)
  if (!entry || entry.dir) return undefined
  return { bytes: await entry.async('uint8array'), contentType }
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
