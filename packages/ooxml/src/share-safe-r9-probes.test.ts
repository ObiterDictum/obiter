import { describe, expect, it } from 'bun:test'

import { buildShareSafeDocx, parseDocx, ShareSafeRefusal } from './index'
import { createXmlOverlay, parseXmlElements } from './parts/overlay'
import type { XmlAttribute, XmlElement } from './parts/xml-elements'
import { assertShareSafeShape } from './share-safe-content'
import { emitShareSafePart } from './share-safe-emit'
import type { ShareSafeContentPlan } from './share-safe-parts'
import { probePackage, W } from './share-safe-probe-kit'

const PACKAGE_REL_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const HYPERLINK_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'

/**
 * R9 hardening: the share-safe shape caps (#295), the override control-byte
 * guard (#294) and the linear cost of the declaration pass.
 */

/** The cap only reads counts, so only the lengths of these shapes matter. */
function shapes(elements: number, attributesEach: number): XmlElement[] {
  return Array.from({ length: elements }, () => ({
    attributes: Array.from({ length: attributesEach }),
  })) as unknown as XmlElement[]
}

describe('share-safe shape caps', () => {
  it('accepts a part exactly at the element cap and refuses one element over', () => {
    expect(() => assertShareSafeShape('p', shapes(100_000, 0))).not.toThrow()
    expect(() => assertShareSafeShape('p', shapes(100_001, 0))).toThrow(
      ShareSafeRefusal,
    )
  })

  it('accepts a part exactly at the attribute cap and refuses one over', () => {
    expect(() => assertShareSafeShape('p', shapes(1, 200_000))).not.toThrow()
    expect(() => assertShareSafeShape('p', shapes(1, 200_001))).toThrow(
      ShareSafeRefusal,
    )
  })

  // The caps fire on the parsed element list, so the oversized part is
  // swapped into an already-parsed package: parsing the huge part through
  // `parseDocx` would spend the very CPU the cap exists to bound.
  async function documentPart() {
    const document = await parseDocx(await probePackage({}))
    const part = document.sourceParts.get('word/document.xml')
    if (!part) throw new Error('document part is missing')
    return { document, part }
  }

  async function refusedReason(
    document: Awaited<ReturnType<typeof parseDocx>>,
  ) {
    const error = await buildShareSafeDocx(document).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(ShareSafeRefusal)
    return (error as ShareSafeRefusal).reason
  }

  it('refuses a part holding more elements than the cap', async () => {
    const { document, part } = await documentPart()
    part.overlay = createXmlOverlay(
      `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${'<w:p/>'.repeat(100_001)}</w:body></w:document>`,
    )
    expect(await refusedReason(document)).toBe('oversized-structure')
  })

  it('refuses a part holding more attributes than the cap', async () => {
    const { document, part } = await documentPart()
    const attributes = Array.from(
      { length: 201 },
      (_, index) => `w:k${index}="1"`,
    ).join(' ')
    part.overlay = createXmlOverlay(
      `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${`<w:p ${attributes}/>`.repeat(1000)}</w:body></w:document>`,
    )
    expect(await refusedReason(document)).toBe('oversized-structure')
  })
})

describe('share-safe declaration cost', () => {
  it('analyses a part of 40k declarations in linear time', async () => {
    const count = 40_000
    // Non-self-closing: the whitespace-declaration pass only inspects elements
    // with an end tag, which is the shape the pass used to filter per element.
    const relationships = Array.from(
      { length: count },
      (_, index) =>
        `<Relationship Id="rId${index}" Type="${HYPERLINK_REL}" Target="https://example.test/${index}" TargetMode="External"> </Relationship>`,
    ).join('')
    const document = await parseDocx(
      await probePackage({ documentRels: relationships }),
    )
    const part = document.sourceParts.get('word/_rels/document.xml.rels')
    if (!part) throw new Error('relationships part is missing')
    part.overlay = createXmlOverlay(
      `<?xml version="1.0"?><Relationships xmlns="${PACKAGE_REL_NAMESPACE}">${relationships}</Relationships>`,
    )

    // The whitespace-declaration pass used to filter the whole element list
    // per declaration: this many relationships took >10 s there and under 2 s
    // once children are indexed once. The runner's 5 s timeout is the bound —
    // quadratic work exceeds it, linear work does not.
    const error = await buildShareSafeDocx(document).catch((thrown) => thrown)
    expect(error).not.toBeInstanceOf(ShareSafeRefusal)
  })
})

describe('share-safe override emission', () => {
  // The field rewrite tokenises an instruction, so a control byte cannot
  // reach an override through a real package. The emitter is exercised
  // directly to pin the check that an override carrying a C0 byte refuses
  // rather than emitting an invalid XML 1.0 document.
  const source = `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>Visible.</w:t></w:r></w:p></w:body></w:document>`

  function part() {
    return {
      name: 'word/document.xml',
      kind: 'xml' as const,
      role: 'story' as const,
      originalPayload: new TextEncoder().encode(source),
      dirty: false,
      overlay: createXmlOverlay(source),
      trackedChanges: [],
    }
  }

  function planFor(select: 'text' | 'attr'): ShareSafeContentPlan {
    const elements = parseXmlElements(source)
    const textOverrides = new Map<XmlElement, string>()
    const attrOverrides = new Map<XmlAttribute, string | undefined>()
    if (select === 'text') {
      const target = elements.find((element) => element.localName === 't')
      if (!target) throw new Error('w:t is missing')
      textOverrides.set(target, 'x\u0007y')
    } else {
      const target = elements.find((element) => element.localName === 'jc')
        ?.attributes[0]
      if (!target) throw new Error('w:val is missing')
      attrOverrides.set(target, 'x\u0007y')
    }
    return {
      elements,
      removed: new Set(),
      unwrapped: new Set(),
      textOverrides,
      attrOverrides,
    }
  }

  function reasonFor(plan: ShareSafeContentPlan) {
    const error = (() => {
      try {
        emitShareSafePart(part(), plan)
      } catch (thrown) {
        return thrown
      }
      return undefined
    })()
    expect(error).toBeInstanceOf(ShareSafeRefusal)
    return (error as ShareSafeRefusal).reason
  }

  it('refuses a control character in a text override', () => {
    expect(reasonFor(planFor('text'))).toBe('malformed-package')
  })

  it('refuses a control character in an attribute override', () => {
    expect(reasonFor(planFor('attr'))).toBe('malformed-package')
  })

  it('refuses a control character in an unmodified source attribute', () => {
    // The override path is defence in depth: this is the reachable shape.
    const hostile = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="A\u0007B"/></w:rPr><w:t>Visible.</w:t></w:r></w:p></w:body></w:document>`
    const payload = {
      ...part(),
      originalPayload: new TextEncoder().encode(hostile),
      overlay: createXmlOverlay(hostile),
    }
    const plan: ShareSafeContentPlan = {
      elements: parseXmlElements(hostile),
      removed: new Set(),
      unwrapped: new Set(),
      textOverrides: new Map(),
      attrOverrides: new Map(),
    }
    expect(() => emitShareSafePart(payload, plan)).toThrow(ShareSafeRefusal)
  })
})
