import { describe, expect, it } from 'vitest'

import {
  compareOoxmlPackages,
  compareXmlSemantics,
  type ComparableOoxmlPart,
} from './equivalence'

const equivalent = (expected: string, actual: string) =>
  compareXmlSemantics(expected, actual).equivalent

describe('compareXmlSemantics', () => {
  it('accepts namespace prefix renames and attribute reordering', () => {
    const expected =
      '<w:document xmlns:w="urn:word" xmlns:r="urn:rels" w:flag="yes" r:id="rId1"><w:p/></w:document>'
    const actual =
      '<doc:document xmlns:rel="urn:rels" rel:id="rId1" xmlns:doc="urn:word" doc:flag="yes"><doc:p></doc:p></doc:document>'

    expect(equivalent(expected, actual)).toBe(true)
  })

  it('resolves default namespaces without applying them to attributes', () => {
    const expected = '<root xmlns="urn:root" value="1"><child/></root>'
    const actual = '<x:root xmlns:x="urn:root" value="1"><x:child/></x:root>'

    expect(equivalent(expected, actual)).toBe(true)
  })

  it('accepts decoded references, CDATA, and equivalent empty forms', () => {
    const expected = '<root value="A&amp;B">A&#32;&lt;B&gt;</root>'
    const actual = '<root value="A&#38;B"><![CDATA[A <B>]]></root>'

    expect(equivalent(expected, actual)).toBe(true)
    expect(equivalent('<root/>', '<root></root>')).toBe(true)
  })

  it('excludes the XML declaration', () => {
    const expected = '<?xml version="1.0" encoding="UTF-8"?><root/>'
    const actual = "<?xml version='1.1'?><root/>"

    expect(equivalent(expected, actual)).toBe(true)
  })

  it.each([
    ['a dropped element', '<root><a/><b/></root>', '<root><a/></root>'],
    [
      'a changed namespace URI',
      '<x:root xmlns:x="urn:one"/>',
      '<x:root xmlns:x="urn:two"/>',
    ],
    ['a changed attribute value', '<root value="one"/>', '<root value="two"/>'],
    ['changed text', '<root>one</root>', '<root>two</root>'],
    ['changed whitespace', '<root>one two</root>', '<root>one  two</root>'],
    [
      'reordered siblings',
      '<root><first/><second/></root>',
      '<root><second/><first/></root>',
    ],
  ])('rejects %s', (_label, expected, actual) => {
    expect(equivalent(expected, actual)).toBe(false)
  })

  it('compares comments in sequence by exact text', () => {
    expect(
      equivalent('<root><!--one--><a/></root>', '<root><!--one--><a/></root>'),
    ).toBe(true)
    expect(
      equivalent('<root><!--one--><a/></root>', '<root><!--two--><a/></root>'),
    ).toBe(false)
    expect(
      equivalent('<root><!--one--><a/></root>', '<root><a/><!--one--></root>'),
    ).toBe(false)
  })

  it('compares processing instruction targets and data in sequence', () => {
    expect(
      equivalent(
        '<root><?review keep?></root>',
        '<root><?review keep?></root>',
      ),
    ).toBe(true)
    expect(
      equivalent(
        '<root><!--<?ignored one?>--><![CDATA[<?ignored two?>]]></root>',
        '<root><!--<?ignored one?>--><![CDATA[<?ignored two?>]]></root>',
      ),
    ).toBe(true)
    expect(
      equivalent('<root><?review keep?></root>', '<root><?other keep?></root>'),
    ).toBe(false)
    expect(
      equivalent(
        '<root><?review keep?></root>',
        '<root><?review drop?></root>',
      ),
    ).toBe(false)
    expect(
      equivalent(
        '<root><?review keep?><a/></root>',
        '<root><a/><?review keep?></root>',
      ),
    ).toBe(false)
  })

  it('fails closed on external DTDs and entity declarations', () => {
    const external = '<!DOCTYPE root SYSTEM "file:///private/source"><root/>'
    const entity =
      '<!DOCTYPE root [<!ENTITY source "secret">]><root>&source;</root>'

    expect(compareXmlSemantics(external, external)).toEqual({
      equivalent: false,
      reason: 'unsupported-or-malformed-xml',
    })
    expect(compareXmlSemantics(entity, entity)).toEqual({
      equivalent: false,
      reason: 'unsupported-or-malformed-xml',
    })
  })

  it('fails closed on malformed XML, unsupported entities, and unbound prefixes', () => {
    expect(equivalent('<root>', '<root>')).toBe(false)
    expect(equivalent('<root>&unknown;</root>', '<root>&unknown;</root>')).toBe(
      false,
    )
    expect(equivalent('<x:root/>', '<x:root/>')).toBe(false)
  })
})

describe('compareOoxmlPackages', () => {
  const packageWith = (...parts: [string, ComparableOoxmlPart][]) =>
    new Map(parts)

  it('requires the same part set', () => {
    const expected = packageWith([
      'word/document.xml',
      { kind: 'xml', xml: '<root/>' },
    ])
    const actual = packageWith(
      ['word/document.xml', { kind: 'xml', xml: '<root/>' }],
      ['word/header1.xml', { kind: 'xml', xml: '<root/>' }],
    )

    expect(compareOoxmlPackages(expected, actual)).toEqual({
      equivalent: false,
      reason: 'part-set-mismatch',
    })
  })

  it('compares every XML part semantically and binary parts byte-for-byte', () => {
    const expected = packageWith(
      [
        '[Content_Types].xml',
        { kind: 'xml', xml: '<Types xmlns="urn:types"/>' },
      ],
      [
        'word/document.xml',
        { kind: 'xml', xml: '<w:doc xmlns:w="urn:word"/>' },
      ],
      [
        'word/media/image.png',
        { kind: 'binary', bytes: new Uint8Array([1, 2, 3]) },
      ],
    )
    const equivalentActual = packageWith(
      [
        '[Content_Types].xml',
        { kind: 'xml', xml: '<t:Types xmlns:t="urn:types"></t:Types>' },
      ],
      [
        'word/document.xml',
        { kind: 'xml', xml: '<doc:doc xmlns:doc="urn:word"/>' },
      ],
      [
        'word/media/image.png',
        { kind: 'binary', bytes: new Uint8Array([1, 2, 3]) },
      ],
    )
    const changedBinary = new Map(equivalentActual)
    changedBinary.set('word/media/image.png', {
      kind: 'binary',
      bytes: new Uint8Array([1, 2, 4]),
    })

    expect(compareOoxmlPackages(expected, equivalentActual)).toEqual({
      equivalent: true,
    })
    expect(compareOoxmlPackages(expected, changedBinary)).toEqual({
      equivalent: false,
      reason: 'binary-payload-mismatch',
      partName: 'word/media/image.png',
    })
  })
})
