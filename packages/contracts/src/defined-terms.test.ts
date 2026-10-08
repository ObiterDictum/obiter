import { describe, expect, it } from 'bun:test'

import {
  definedTermBookmarkName,
  definedTermFromBookmarkName,
  definedTermWords,
} from './defined-terms'
import { documentEditOperationSchema } from './document-edit'

describe('definedTermWords', () => {
  it('normalises the marked text to lowercase word characters', () => {
    expect(definedTermWords('Hourly Rate')).toEqual(['hourly', 'rate'])
    expect(definedTermWords('“Services”')).toEqual(['services'])
    expect(definedTermWords('the Supplier’s Materials')).toEqual([
      'the',
      'supplier',
      's',
      'materials',
    ])
  })

  it('returns null when the text carries no word characters', () => {
    expect(definedTermWords('  ')).toBeNull()
    expect(definedTermWords('§ 12(3)')).toEqual(['12', '3'])
    expect(definedTermWords('—')).toBeNull()
  })
})

describe('definedTermBookmarkName', () => {
  it('joins the term words under the _Def_ prefix', () => {
    expect(definedTermBookmarkName('Hourly Rate')).toBe('_Def_hourly_rate')
    expect(definedTermBookmarkName('Term')).toBe('_Def_term')
  })

  it('refuses text with no words and text that outgrows the name cap', () => {
    expect(definedTermBookmarkName('   ')).toBeNull()
    // _Def_ plus eight five-letter words exceeds Word's 40-character cap.
    expect(
      definedTermBookmarkName('aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa'),
    ).toBeNull()
    // The cap boundary itself is accepted: _Def_ plus 35 letters is 40.
    const boundary = 'a'.repeat(35)
    expect(definedTermBookmarkName(boundary)).toBe(`_Def_${boundary}`)
    expect(definedTermBookmarkName(`${boundary}a`)).toBeNull()
  })
})

describe('definedTermFromBookmarkName', () => {
  it('decodes the name the writer produces', () => {
    expect(definedTermFromBookmarkName('_Def_hourly_rate')).toEqual({
      words: ['hourly', 'rate'],
    })
    expect(definedTermFromBookmarkName('_Def_term')).toEqual({
      words: ['term'],
    })
  })

  it('returns null for other bookmark families and malformed suffixes', () => {
    expect(definedTermFromBookmarkName('_Ref_12345')).toBeNull()
    expect(definedTermFromBookmarkName('_Toc12345')).toBeNull()
    expect(definedTermFromBookmarkName('heading-1')).toBeNull()
    expect(definedTermFromBookmarkName('_Def_')).toBeNull()
    expect(definedTermFromBookmarkName('_Def_foo__bar')).toBeNull()
    expect(definedTermFromBookmarkName('_Def_foo-bar')).toBeNull()
    expect(definedTermFromBookmarkName('_Def_trailing_')).toBeNull()
  })

  it('round-trips writer output', () => {
    const name = definedTermBookmarkName('Supply of Materials')
    expect(name).not.toBeNull()
    expect(definedTermFromBookmarkName(name ?? '')).toEqual({
      words: ['supply', 'of', 'materials'],
    })
  })
})

describe('mark_defined_term operation', () => {
  it('parses a forward range', () => {
    const parsed = documentEditOperationSchema.safeParse({
      type: 'mark_defined_term',
      paragraphId: 'p1',
      from: 4,
      to: 17,
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses empty, backward and extra-field operations', () => {
    for (const operation of [
      { type: 'mark_defined_term', paragraphId: 'p1', from: 5, to: 5 },
      { type: 'mark_defined_term', paragraphId: 'p1', from: 9, to: 4 },
      {
        type: 'mark_defined_term',
        paragraphId: 'p1',
        from: 0,
        to: 4,
        name: '_Def_term',
      },
      { type: 'mark_defined_term', paragraphId: 'p1', from: -1, to: 4 },
    ]) {
      expect(documentEditOperationSchema.safeParse(operation).success).toBe(
        false,
      )
    }
  })
})
