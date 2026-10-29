import { expect } from 'bun:test'
import JSZip from 'jszip'

export async function expectPartsByteIdentical(
  before: Uint8Array,
  after: Uint8Array,
  names: readonly string[],
) {
  const original = await JSZip.loadAsync(before)
  const edited = await JSZip.loadAsync(after)
  for (const name of names) {
    const source = original.file(name)
    const output = edited.file(name)
    if (!source || !output) throw new Error(`Missing part ${name}.`)
    expect(await output.async('uint8array')).toEqual(
      await source.async('uint8array'),
    )
  }
}
