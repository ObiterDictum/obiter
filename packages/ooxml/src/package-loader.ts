import JSZip from 'jszip'

import { mapWithConcurrency } from './inflate-pool'
import { OoxmlError } from './model'
import {
  DEFAULT_OOXML_PACKAGE_LIMITS,
  type OoxmlPackageLimits,
} from './package-limits-defaults'
import {
  assertZipCentralDirectoryLimits,
  parseZipCentralDirectory,
  type PackageLimitViolation,
  type ZipCentralDirectory,
} from './zip-central-directory'

export function packageLimitViolationMessage(
  violation: PackageLimitViolation,
): string {
  switch (violation) {
    case 'entries':
      return 'The document package exceeds the allowed entry count.'
    case 'uncompressed-total':
      return 'The document package exceeds the allowed uncompressed size.'
    case 'entry-uncompressed':
      return 'The document package contains an entry that exceeds the allowed uncompressed size.'
    case 'compression-ratio':
      return 'The document package exceeds the allowed compression ratio.'
  }
}

export function assertOoxmlPackageCentralDirectory(
  input: Uint8Array,
  limits: OoxmlPackageLimits = DEFAULT_OOXML_PACKAGE_LIMITS,
): ZipCentralDirectory {
  let directory
  try {
    directory = parseZipCentralDirectory(input)
  } catch {
    throw new OoxmlError('invalid-package')
  }

  const violation = assertZipCentralDirectoryLimits(directory, limits)
  if (violation) throw limitsExceeded(violation)
  return directory
}

function limitsExceeded(violation: PackageLimitViolation) {
  return new OoxmlError(
    'package-limits-exceeded',
    packageLimitViolationMessage(violation),
  )
}

interface EntryStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): EntryStream
  on(event: 'error', listener: (error: Error) => void): EntryStream
  on(event: 'end', listener: () => void): EntryStream
  pause(): EntryStream
  resume(): EntryStream
}

type StreamableEntry = JSZip.JSZipObject & {
  internalStream(type: 'uint8array'): EntryStream
}

function inflateWithinLimit(
  entry: StreamableEntry,
  entryCap: number,
  claimTotal: (bytes: number) => boolean,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let received = 0
    let settled = false
    const stream = entry.internalStream('uint8array')
    const fail = (error: OoxmlError) => {
      if (settled) return
      settled = true
      stream.pause()
      chunks.length = 0
      reject(error)
    }
    stream
      .on('data', (chunk: Uint8Array) => {
        if (settled) return
        received += chunk.byteLength
        if (received > entryCap) {
          fail(limitsExceeded('entry-uncompressed'))
          return
        }
        if (!claimTotal(chunk.byteLength)) {
          fail(limitsExceeded('uncompressed-total'))
          return
        }
        chunks.push(chunk)
      })
      .on('error', () => fail(new OoxmlError('invalid-package')))
      .on('end', () => {
        if (settled) return
        settled = true
        const bytes = new Uint8Array(received)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        resolve(bytes)
      })
      .resume()
  })
}

export async function loadOoxmlZipEntries(
  input: Uint8Array,
  limits: OoxmlPackageLimits = DEFAULT_OOXML_PACKAGE_LIMITS,
): Promise<Map<string, Uint8Array>> {
  const directory = assertOoxmlPackageCentralDirectory(input, limits)
  const declaredSizes = new Map(
    directory.entries.map((entry) => [entry.name, entry.uncompressedSize]),
  )

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    throw new OoxmlError('invalid-package')
  }

  const fileEntries = Object.values(zip.files).filter(
    (entry): entry is StreamableEntry => !entry.dir,
  )
  let actualUncompressedBytes = 0
  const claimTotal = (bytes: number) => {
    actualUncompressedBytes += bytes
    return actualUncompressedBytes <= limits.maxUncompressedBytes
  }
  const payloads = new Map<string, Uint8Array>()

  await mapWithConcurrency(
    fileEntries,
    limits.inflateConcurrency,
    async (entry) => {
      const entryCap = Math.min(
        declaredSizes.get(entry.name) ?? limits.maxEntryUncompressedBytes,
        limits.maxEntryUncompressedBytes,
      )
      payloads.set(
        entry.name,
        await inflateWithinLimit(entry, entryCap, claimTotal),
      )
    },
  )

  return payloads
}
