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
): void {
  let directory
  try {
    directory = parseZipCentralDirectory(input)
  } catch {
    throw new OoxmlError('invalid-package')
  }

  const violation = assertZipCentralDirectoryLimits(directory, limits)
  if (violation) {
    throw new OoxmlError(
      'package-limits-exceeded',
      packageLimitViolationMessage(violation),
    )
  }
}

export async function loadOoxmlZipEntries(
  input: Uint8Array,
  limits: OoxmlPackageLimits = DEFAULT_OOXML_PACKAGE_LIMITS,
): Promise<Map<string, Uint8Array>> {
  assertOoxmlPackageCentralDirectory(input, limits)

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    throw new OoxmlError('invalid-package')
  }

  const fileEntries = Object.values(zip.files).filter((entry) => !entry.dir)
  let actualUncompressedBytes = 0
  const payloads = new Map<string, Uint8Array>()

  await mapWithConcurrency(
    fileEntries,
    limits.inflateConcurrency,
    async (entry) => {
      const bytes = await entry.async('uint8array')
      actualUncompressedBytes += bytes.byteLength
      if (actualUncompressedBytes > limits.maxUncompressedBytes) {
        throw new OoxmlError(
          'package-limits-exceeded',
          packageLimitViolationMessage('uncompressed-total'),
        )
      }
      if (bytes.byteLength > limits.maxEntryUncompressedBytes) {
        throw new OoxmlError(
          'package-limits-exceeded',
          packageLimitViolationMessage('entry-uncompressed'),
        )
      }
      payloads.set(entry.name, bytes)
    },
  )

  return payloads
}
