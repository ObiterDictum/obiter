import { canonicaliseXml } from './xml-canonicalisation'

export type ComparableOoxmlPart =
  { kind: 'xml'; xml: string } | { kind: 'binary'; bytes: Uint8Array }

export type ComparableOoxmlPackage = ReadonlyMap<string, ComparableOoxmlPart>

export type SemanticEquivalenceResult =
  | { equivalent: true }
  | {
      equivalent: false
      reason:
        | 'part-set-mismatch'
        | 'part-kind-mismatch'
        | 'binary-payload-mismatch'
        | 'unsupported-or-malformed-xml'
        | 'xml-node-sequence-mismatch'
      partName?: string
    }

export function compareXmlSemantics(
  expectedXml: string,
  actualXml: string,
): SemanticEquivalenceResult {
  const expected = canonicaliseXml(expectedXml)
  const actual = canonicaliseXml(actualXml)

  if (!expected || !actual) {
    return { equivalent: false, reason: 'unsupported-or-malformed-xml' }
  }

  return JSON.stringify(expected) === JSON.stringify(actual)
    ? { equivalent: true }
    : { equivalent: false, reason: 'xml-node-sequence-mismatch' }
}

export function compareOoxmlPackages(
  expected: ComparableOoxmlPackage,
  actual: ComparableOoxmlPackage,
): SemanticEquivalenceResult {
  const expectedNames = [...expected.keys()].sort()
  const actualNames = [...actual.keys()].sort()

  if (!sameStrings(expectedNames, actualNames)) {
    return { equivalent: false, reason: 'part-set-mismatch' }
  }

  for (const partName of expectedNames) {
    const expectedPart = expected.get(partName)
    const actualPart = actual.get(partName)

    if (!expectedPart || !actualPart || expectedPart.kind !== actualPart.kind) {
      return { equivalent: false, reason: 'part-kind-mismatch', partName }
    }

    if (expectedPart.kind === 'binary' && actualPart.kind === 'binary') {
      if (!sameBytes(expectedPart.bytes, actualPart.bytes)) {
        return {
          equivalent: false,
          reason: 'binary-payload-mismatch',
          partName,
        }
      }
      continue
    }

    if (expectedPart.kind === 'xml' && actualPart.kind === 'xml') {
      const comparison = compareXmlSemantics(expectedPart.xml, actualPart.xml)
      if (!comparison.equivalent) return { ...comparison, partName }
    }
  }

  return { equivalent: true }
}

function sameStrings(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
