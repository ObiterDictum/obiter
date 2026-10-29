import { describe, expect, it } from 'bun:test'

import { buildShareSafeDocx, parseDocx, ShareSafeRefusal } from './index'
import { createXmlOverlay, parseXmlElements } from './parts/overlay'
import type { XmlAttribute, XmlElement } from './parts/xml-elements'
import { cloneDocument } from './serialise'
import { assertShareSafeShape } from './share-safe-content'
import { emitShareSafePart } from './share-safe-emit'
import { SHARE_SAFE_MAX_FIELD_NESTING } from './share-safe-fields'
import { planShareSafeCopy } from './share-safe-inventory'
import type { ShareSafeContentPlan } from './share-safe-parts'
import { MC, outputParts, probePackage, W, W14 } from './share-safe-probe-kit'

const PACKAGE_REL_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const HYPERLINK_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'

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

    const error = await buildShareSafeDocx(document).catch((thrown) => thrown)
    expect(error).not.toBeInstanceOf(ShareSafeRefusal)
  })
})

describe('share-safe content cost', () => {
  async function planBody(body: string) {
    const pkg = await parseDocx(await probePackage({}))
    const part = pkg.sourceParts.get('word/document.xml')
    if (!part) throw new Error('document part is missing')
    part.overlay = createXmlOverlay(
      `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:mc="${MC}"><w:body>${body}</w:body></w:document>`,
    )
    const started = Date.now()
    planShareSafeCopy(cloneDocument(pkg))
    return Date.now() - started
  }

  const alternate = `<mc:AlternateContent><mc:Choice xmlns:w14="${W14}" Requires="w14"><w:p/></mc:Choice><mc:Fallback><w:t>FB</w:t></mc:Fallback></mc:AlternateContent>`

  function commentRun() {
    return '<w:r><w:commentReference w:id="1"/></w:r>'
  }

  function flatField(index: number) {
    return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE ${index} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
  }

  it('plans 16000 compatibility blocks in linear time', async () => {
    expect(
      await planBody(`<w:p><w:r>${alternate.repeat(16_000)}</w:r></w:p>`),
    ).toBeLessThan(5_000)
  })

  it('plans 32000 comment-marker runs in linear time', async () => {
    expect(
      await planBody(`<w:p>${commentRun().repeat(32_000)}</w:p>`),
    ).toBeLessThan(5_000)
  })

  it('plans one run holding many comment references in linear time', async () => {
    const body = `<w:p><w:r>STRAY${'<w:commentReference w:id="1"/>'.repeat(32_000)}</w:r></w:p>`
    expect(await planBody(body)).toBeLessThan(5_000)
  })

  it('plans 16000 flat fields in linear time', async () => {
    const fields = Array.from({ length: 16_000 }, (_, index) =>
      flatField(index),
    ).join('')
    expect(await planBody(`<w:p>${fields}</w:p>`)).toBeLessThan(5_000)
  })

  it('refuses a part nesting fields past the cap', async () => {
    const depth = SHARE_SAFE_MAX_FIELD_NESTING + 1
    const nested =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'.repeat(depth) +
      '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>'.repeat(depth)
    const error = await planBody(`<w:p>${nested}</w:p>`).catch(
      (thrown) => thrown,
    )
    expect(error).toBeInstanceOf(ShareSafeRefusal)
    expect((error as ShareSafeRefusal).reason).toBe('oversized-structure')
  })
})

describe('share-safe field span extent', () => {
  it('keeps text after a remove-class end marker in the same run', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> SET x "v" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/><w:t>AFTERINRUN</w:t></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('AFTERINRUN')
    expect(story).not.toContain('SET')
  })

  it('keeps paragraphs after a multi-paragraph remove-class field', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p><w:p><w:r><w:instrText> SET x "v" </w:instrText></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>TAILP3</w:t></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('TAILP3')
  })
})

describe('share-safe override emission', () => {
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
