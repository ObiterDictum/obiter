import type { SourcePart } from '../model'

export function createOpaquePart(
  name: string,
  kind: SourcePart['kind'],
  originalPayload: Uint8Array,
): SourcePart {
  return {
    name,
    kind,
    role: 'opaque',
    originalPayload,
    dirty: false,
    trackedChanges: [],
  }
}
