import { describe, expect, it } from 'bun:test'

import {
  A,
  expectRefusal,
  outputParts,
  PIC,
  R,
  rel,
  W,
  WP,
  type ProbeSpec,
} from './share-safe-probe-kit'

const PKG_R = 'http://schemas.openxmlformats.org/package/2006/relationships'

describe('share-safe r4: binary payloads', () => {
  const png = (extraChunks: Uint8Array[]) => {
    const ihdr = new Uint8Array([
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00,
    ])
    const idat = new Uint8Array([
      0x00, 0x00, 0x00, 0x02, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x00, 0x00,
      0x00, 0x00,
    ])
    const iend = new Uint8Array([
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    const body = [ihdr, ...extraChunks, idat, iend]
    const total = 8 + body.reduce((sum, chunk) => sum + chunk.length, 0)
    const out = new Uint8Array(total)
    out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    let cursor = 8
    for (const chunk of body) {
      out.set(chunk, cursor)
      cursor += chunk.length
    }
    return out
  }

  const chunk = (type: string, data: number[]) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length, false)
    for (let index = 0; index < 4; index += 1)
      out[4 + index] = type.charCodeAt(index)
    out.set(data, 8)
    return out
  }

  const imageSpec = (
    name: string,
    payload: Uint8Array,
    defaults = '<Default Extension="png" ContentType="image/png"/>',
  ): ProbeSpec => ({
    documentRels: rel('rId9', 'image', `media/${name}`),
    body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    parts: { [`word/media/${name}`]: payload },
    defaults,
  })

  it('sPLT chunk name text does not ship', async () => {
    const splt = chunk('sPLT', [
      ...new TextEncoder().encode('SECRETPALETTE'),
      0,
      8,
    ])
    const { binary } = await outputParts(imageSpec('i.png', png([splt])))
    const emitted = binary.get('word/media/image1.png')
    expect(emitted).toBeDefined()
    expect(new TextDecoder('latin1').decode(emitted!)).not.toContain('SECRET')
    expect(new TextDecoder('latin1').decode(emitted!)).not.toContain('sPLT')
  })

  it('iCCP profile payload does not ship', async () => {
    const iccp = chunk('iCCP', [...new TextEncoder().encode('SECRETPROFILE')])
    const { binary } = await outputParts(imageSpec('i.png', png([iccp])))
    const emitted = binary.get('word/media/image1.png')
    expect(emitted).toBeDefined()
    expect(new TextDecoder('latin1').decode(emitted!)).not.toContain('SECRET')
  })

  it('BMP payload refuses — magic bytes are not format verification', async () => {
    const bmp = new Uint8Array([
      0x42,
      0x4d,
      ...new TextEncoder().encode('SECRETBMPBODY'),
    ])
    await expectRefusal(
      imageSpec(
        'i.bmp',
        bmp,
        '<Default Extension="bmp" ContentType="image/bmp"/>',
      ),
    )
  })

  it('ICO payload refuses — magic bytes are not format verification', async () => {
    const ico = new Uint8Array([
      0x00,
      0x00,
      0x01,
      0x00,
      ...new TextEncoder().encode('SECRETICOBODY'),
    ])
    await expectRefusal(
      imageSpec(
        'i.ico',
        ico,
        '<Default Extension="ico" ContentType="image/x-icon"/>',
      ),
    )
  })

  it('embedded font part and its w:embed* pointers drop', async () => {
    const ttf = new Uint8Array([
      0x00,
      0x01,
      0x00,
      0x00,
      ...new TextEncoder().encode('SECRETFONTBODY'),
    ])
    const { parts, binary } = await outputParts({
      documentRels: rel('rId9', 'fontTable', 'fonts.xml'),
      overrides:
        '<Override PartName="/word/fonts.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fonts+xml"/><Override PartName="/word/fonts/f.ttf" ContentType="application/x-fontdata"/>',
      parts: {
        'word/fonts.xml': `<?xml version="1.0"?><w:fonts xmlns:w="${W}" xmlns:r="${R}"><w:font w:name="Calibri"><w:embedRegular r:id="rIdF"/></w:font></w:fonts>`,
        'word/_rels/fonts.xml.rels': `<Relationships xmlns="${PKG_R}"><Relationship Id="rIdF" Type="${R}/font" Target="f.ttf"/></Relationships>`,
        'word/fonts/f.ttf': ttf,
      },
    })
    expect(binary.get('word/fonts/f.ttf')).toBeUndefined()
    const fonts = parts.get('word/fontTable.xml') ?? ''
    expect(fonts).not.toContain('embedRegular')
    expect(fonts).not.toContain('rIdF')
    expect(fonts).toContain('Calibri')
  })

  it('GIF comment and application extensions drop', async () => {
    const gif = new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x00,
      // comment extension: 0x21 0xfe, sub-block 'SECRETGIF', terminator
      0x21,
      0xfe,
      0x09,
      ...new TextEncoder().encode('SECRETGIF'),
      0x00,
      // image descriptor + minimal image data
      0x2c,
      0x00,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00,
      0x02,
      0x01,
      0x44,
      0x00,
      // trailer
      0x3b,
    ])
    const { binary } = await outputParts(
      imageSpec(
        'i.gif',
        gif,
        '<Default Extension="gif" ContentType="image/gif"/>',
      ),
    )
    const emitted = binary.get('word/media/image1.gif')
    expect(emitted).toBeDefined()
    expect(new TextDecoder('latin1').decode(emitted!)).not.toContain(
      'SECRETGIF',
    )
    expect(emitted![emitted!.length - 1]).toBe(0x3b)
  })

  it('PNG with unknown critical chunk refuses', async () => {
    const critical = chunk('XYZQ', [1, 2, 3])
    await expectRefusal(imageSpec('i.png', png([critical])))
  })

  it('PNG with trailing bytes refuses', async () => {
    const payload = png([])
    const withTail = new Uint8Array(payload.length + 6)
    withTail.set(payload, 0)
    withTail.set(
      new TextEncoder().encode('SECRET').subarray(0, 6),
      payload.length,
    )
    await expectRefusal(imageSpec('i.png', withTail))
  })

  it('JPEG APPn and COM segments drop, scan survives', async () => {
    const jpeg = new Uint8Array([
      0xff,
      0xd8, // SOI
      0xff,
      0xe1,
      0x00,
      0x0c,
      ...new TextEncoder().encode('ExifSECRET').subarray(0, 10), // APP1
      0xff,
      0xfe,
      0x00,
      0x08,
      ...new TextEncoder().encode('COMSEC').subarray(0, 6), // COM
      0xff,
      0xdb,
      0x00,
      0x04,
      0x00,
      0x00, // DQT
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x01,
      0x00,
      0x01,
      0x01,
      0x01,
      0x11,
      0x00, // SOF0
      0xff,
      0xc4,
      0x00,
      0x04,
      0x00,
      0x00, // DHT
      0xff,
      0xda,
      0x00,
      0x08,
      0x01,
      0x01,
      0x00,
      0x00,
      0x3f,
      0x00, // SOS
      0x11,
      0x22,
      0x33, // scan entropy
      0xff,
      0xd9, // EOI
    ])
    const { binary } = await outputParts(
      imageSpec(
        'i.jpg',
        jpeg,
        '<Default Extension="jpg" ContentType="image/jpeg"/>',
      ),
    )
    const emitted = binary.get('word/media/image1.jpeg')
    expect(emitted).toBeDefined()
    const text = new TextDecoder('latin1').decode(emitted!)
    expect(text).not.toContain('ExifSECRET')
    expect(text).not.toContain('COMSEC')
    expect(emitted![0]).toBe(0xff)
    expect(emitted![1]).toBe(0xd8)
    expect(emitted![emitted!.length - 2]).toBe(0xff)
    expect(emitted![emitted!.length - 1]).toBe(0xd9)
  })
})

describe('share-safe r4: drawing and theme', () => {
  const themeSpec = (inner: string): ProbeSpec => ({
    rootRels: `<Relationship Id="rId8" Type="${R}/theme" Target="theme/theme1.xml"/>`,
    overrides:
      '<Override PartName="/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    parts: {
      'theme/theme1.xml': `<?xml version="1.0"?><a:theme xmlns:a="${A}" name="SECRETTHEMENAME"><a:themeElements>${inner}</a:themeElements></a:theme>`,
    },
  })

  it('theme and scheme names strip, font typefaces keep', async () => {
    const { parts } = await outputParts(
      themeSpec(
        `<a:fontScheme name="SECRETSCHEME"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="x"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`,
      ),
    )
    const theme = parts.get('word/theme/theme1.xml') ?? ''
    expect(theme).not.toContain('SECRETTHEMENAME')
    expect(theme).not.toContain('SECRETSCHEME')
    // `typeface` is the font's face name — rendering, not a label.
    expect(theme).toContain('typeface="Calibri"')
  })

  it('typeface out of element scope strips', async () => {
    const { parts } = await outputParts(
      themeSpec(
        `<a:fontScheme><a:majorFont typeface="SECRETMISPLACED"><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="x"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`,
      ),
    )
    expect(parts.get('word/theme/theme1.xml') ?? '').not.toContain(
      'SECRETMISPLACED',
    )
  })

  it('a:tbl emits without its tableStyleId pointer', async () => {
    const { parts } = await outputParts({
      body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{SECRETGUID}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="100"/></a:tblGrid><a:tr><a:tc><a:txBody><a:p><a:r><a:t>CELL</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('SECRETGUID')
    expect(story).not.toContain('tableStyleId')
    expect(story).toContain('CELL')
    expect(story).toContain('bandRow="1"')
  })

  it('wps textbox content emits', async () => {
    const { parts } = await outputParts({
      body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:txbx><w:txbxContent><w:p><w:pPr><w:rPr/></w:pPr><w:r><w:t>TEXTBOX</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    })
    expect(parts.get('word/document.xml') ?? '').toContain('TEXTBOX')
  })
})
