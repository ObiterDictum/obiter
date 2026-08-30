import { describe, expect, it } from 'vitest'
import {
  assertOoxmlPackageCentralDirectory,
  getActiveInflateCount,
  loadOoxmlZipEntries,
  mapWithConcurrency,
  OOXML_MAX_COMPRESSION_RATIO,
  OOXML_MAX_ENTRIES,
  OOXML_MAX_UNCOMPRESSED_BYTES,
  OOXML_INFLATE_CONCURRENCY,
  OoxmlError,
  parseDocx,
} from './index'

const LOCAL_SIGNATURE = 0x04034b50
const CD_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true)
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true)
}

function buildZipWithCentralDirectory(
  entries: Array<{
    name: string
    compressedSize: number
    uncompressedSize: number
    payload?: Uint8Array
  }>,
) {
  const parts: Uint8Array[] = []
  const localHeaderOffsets: number[] = []
  let offset = 0

  for (const entry of entries) {
    localHeaderOffsets.push(offset)
    const nameBytes = new TextEncoder().encode(entry.name)
    const payload = entry.payload ?? new Uint8Array(entry.compressedSize)
    const local = new Uint8Array(30 + nameBytes.length + payload.length)
    const view = new DataView(local.buffer, local.byteOffset, local.byteLength)
    writeUint32(view, 0, LOCAL_SIGNATURE)
    writeUint16(view, 8, 0)
    writeUint32(view, 18, entry.compressedSize)
    writeUint32(view, 22, entry.uncompressedSize)
    writeUint16(view, 26, nameBytes.length)
    local.set(nameBytes, 30)
    local.set(payload, 30 + nameBytes.length)
    parts.push(local)
    offset += local.byteLength
  }

  const centralStart = offset
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const nameBytes = new TextEncoder().encode(entry.name)
    const central = new Uint8Array(46 + nameBytes.length)
    const view = new DataView(
      central.buffer,
      central.byteOffset,
      central.byteLength,
    )
    writeUint32(view, 0, CD_SIGNATURE)
    writeUint16(view, 10, 0)
    writeUint32(view, 20, entry.compressedSize)
    writeUint32(view, 24, entry.uncompressedSize)
    writeUint16(view, 28, nameBytes.length)
    writeUint32(view, 42, localHeaderOffsets[index]!)
    central.set(nameBytes, 46)
    parts.push(central)
    offset += central.byteLength
  }

  const centralSize = offset - centralStart
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength)
  writeUint32(eocdView, 0, EOCD_SIGNATURE)
  writeUint16(eocdView, 10, entries.length)
  writeUint32(eocdView, 12, centralSize)
  writeUint32(eocdView, 16, centralStart)
  parts.push(eocd)

  const zip = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  )
  let writeOffset = 0
  for (const part of parts) {
    zip.set(part, writeOffset)
    writeOffset += part.byteLength
  }
  return zip
}

describe('OOXML package limits', () => {
  it('rejects a ZIP whose central directory lists more than the allowed entries', () => {
    const entries = Array.from(
      { length: OOXML_MAX_ENTRIES + 1 },
      (_, index) => ({
        name: `part${index}.bin`,
        compressedSize: 1,
        uncompressedSize: 1,
        payload: new Uint8Array([0]),
      }),
    )

    expect(() =>
      assertOoxmlPackageCentralDirectory(buildZipWithCentralDirectory(entries)),
    ).toThrow(OoxmlError)
    try {
      assertOoxmlPackageCentralDirectory(buildZipWithCentralDirectory(entries))
    } catch (error) {
      expect(error).toBeInstanceOf(OoxmlError)
      if (error instanceof OoxmlError) {
        expect(error.code).toBe('package-limits-exceeded')
      }
    }
  })

  it('rejects parseDocx when the central directory exceeds the entry cap', async () => {
    const entries = Array.from(
      { length: OOXML_MAX_ENTRIES + 1 },
      (_, index) => ({
        name: `part${index}.bin`,
        compressedSize: 1,
        uncompressedSize: 1,
        payload: new Uint8Array([0]),
      }),
    )

    await expect(
      parseDocx(buildZipWithCentralDirectory(entries)),
    ).rejects.toMatchObject({
      name: 'OoxmlError',
      code: 'package-limits-exceeded',
    })
  })

  it('rejects a ZIP whose declared uncompressed total exceeds the cap', () => {
    const perEntry = Math.floor(OOXML_MAX_UNCOMPRESSED_BYTES / 2) + 1
    const zip = buildZipWithCentralDirectory([
      {
        name: 'a.bin',
        compressedSize: 16,
        uncompressedSize: perEntry,
        payload: new Uint8Array(16),
      },
      {
        name: 'b.bin',
        compressedSize: 16,
        uncompressedSize: perEntry,
        payload: new Uint8Array(16),
      },
    ])

    expect(() => assertOoxmlPackageCentralDirectory(zip)).toThrow(OoxmlError)
  })

  it('rejects a ZIP whose compression ratio exceeds the configured maximum', () => {
    const zip = buildZipWithCentralDirectory([
      {
        name: 'ratio.bin',
        compressedSize: 512,
        uncompressedSize: 512 * (OOXML_MAX_COMPRESSION_RATIO + 1),
        payload: new Uint8Array(512),
      },
    ])

    expect(() => assertOoxmlPackageCentralDirectory(zip)).toThrow(OoxmlError)
  })

  it('does not start more than three inflates at once', async () => {
    let peak = 0
    await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      OOXML_INFLATE_CONCURRENCY,
      async () => {
        peak = Math.max(peak, getActiveInflateCount())
        await new Promise((resolve) => setTimeout(resolve, 20))
      },
    )
    expect(peak).toBeLessThanOrEqual(OOXML_INFLATE_CONCURRENCY)
  })

  it('loads bounded ZIP entries through the shared loader', async () => {
    const zip = buildZipWithCentralDirectory([
      {
        name: '[Content_Types].xml',
        compressedSize: 8,
        uncompressedSize: 8,
        payload: new TextEncoder().encode('<Types/>'),
      },
      {
        name: 'word/document.xml',
        compressedSize: 10,
        uncompressedSize: 10,
        payload: new TextEncoder().encode('<w:document/>'),
      },
    ])

    await expect(loadOoxmlZipEntries(zip)).resolves.toBeInstanceOf(Map)
  })
})
