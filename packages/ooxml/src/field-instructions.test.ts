import { describe, expect, it } from 'bun:test'

import {
  fieldInstructionName,
  fieldInstructionsInXml,
  fieldSwitchArguments,
  isTableOfAuthoritiesField,
  tableAuthorityMarkMatches,
} from './field-instructions'

const BEGIN = '<w:fldChar w:fldCharType="begin"/>'
const SEPARATE = '<w:fldChar w:fldCharType="separate"/>'
const END = '<w:fldChar w:fldCharType="end"/>'
const instr = (text: string) =>
  `<w:instrText xml:space="preserve">${text}</w:instrText>`

describe('fieldInstructionName', () => {
  it('reads the leading field name case-insensitively', () => {
    expect(fieldInstructionName(' TOA \\h \\c "1" ')).toBe('TOA')
    expect(fieldInstructionName('  toa \\h ')).toBe('TOA')
    expect(fieldInstructionName('PAGEREF _ToA1 \\h')).toBe('PAGEREF')
    expect(fieldInstructionName(' REF _Ref1 ')).toBe('REF')
  })

  it('reports no name when the instruction leads with a switch or quote', () => {
    expect(fieldInstructionName(' \\h ')).toBe('')
    expect(fieldInstructionName(' "TOA" \\h ')).toBe('')
    expect(fieldInstructionName('')).toBe('')
  })
})

describe('fieldSwitchArguments', () => {
  it("collects a switch's quoted and bare arguments", () => {
    expect(fieldSwitchArguments(' TOA \\h \\c "1" ', 'c')).toEqual(['1'])
    expect(
      fieldSwitchArguments(
        ' TA \\l "[2020] UKSC 1" \\s "[2020] UKSC 1" \\c 1 ',
        'l',
      ),
    ).toEqual(['[2020] UKSC 1'])
    expect(fieldSwitchArguments(' TA \\l X \\c 1 ', 'c')).toEqual(['1'])
  })

  it('collects every argument up to the next switch', () => {
    expect(
      fieldSwitchArguments(' X \\a one two "three four" \\b five ', 'a'),
    ).toEqual(['one', 'two', 'three four'])
  })

  it('repeats each occurrence of the switch', () => {
    expect(fieldSwitchArguments(' X \\a 1 \\a 2 ', 'a')).toEqual(['1', '2'])
    expect(fieldSwitchArguments(' X \\a 1 ', 'missing')).toEqual([])
  })
})

describe('isTableOfAuthoritiesField', () => {
  it('matches on the field name, not a substring anywhere', () => {
    expect(isTableOfAuthoritiesField(' TOA \\h \\c "1" ')).toBe(true)
    expect(isTableOfAuthoritiesField(' PAGEREF _ToA1 ')).toBe(false)
    expect(isTableOfAuthoritiesField(' X "TOA" ')).toBe(false)
    expect(isTableOfAuthoritiesField(' MYTOA \\h ')).toBe(false)
  })
})

describe('tableAuthorityMarkMatches', () => {
  it('matches the \\l long-form argument to the citation', () => {
    expect(
      tableAuthorityMarkMatches(
        ' TA \\l "[2020] UKSC 1" \\s "UKSC" \\c 1 ',
        '[2020] UKSC 1',
      ),
    ).toBe(true)
  })

  it('does not match a citation carried only by another switch', () => {
    expect(
      tableAuthorityMarkMatches(
        ' TA \\l "Other" \\s "[2020] UKSC 1" \\c 1 ',
        '[2020] UKSC 1',
      ),
    ).toBe(false)
    expect(
      tableAuthorityMarkMatches(' TOA \\l "[2020] UKSC 1" ', '[2020] UKSC 1'),
    ).toBe(false)
  })
})

describe('fieldInstructionsInXml', () => {
  it('merges an instruction split across instrText runs', () => {
    const xml = [
      `<w:r>${BEGIN}${instr(' TA \\l "[2020]')}</w:r>`,
      `<w:r>${instr(' UKSC 1" \\c 1 ')}</w:r>`,
      `<w:r>${SEPARATE}</w:r><w:r><w:t>x</w:t></w:r><w:r>${END}</w:r>`,
    ].join('')
    expect(fieldInstructionsInXml(xml)).toEqual([
      ' TA \\l "[2020] UKSC 1" \\c 1 ',
    ])
  })

  it('stops accumulating the instruction at the separate character', () => {
    const xml = [
      `<w:r>${BEGIN}${instr(' TOA ')}</w:r>`,
      `<w:r>${SEPARATE}${instr(' not instruction ')}</w:r>`,
      `<w:r>${END}</w:r>`,
    ].join('')
    expect(fieldInstructionsInXml(xml)).toEqual([' TOA '])
  })

  it("keeps two fields' instructions separate", () => {
    const xml = [
      `<w:r>${BEGIN}${instr(' TA \\l "a" ')}${END}</w:r>`,
      `<w:r>${BEGIN}${instr(' TA \\l "b" ')}${END}</w:r>`,
    ].join('')
    expect(fieldInstructionsInXml(xml)).toEqual([
      ' TA \\l "a" ',
      ' TA \\l "b" ',
    ])
  })

  it("nests an inner field's instruction under its own pairing", () => {
    const xml = [
      `<w:r>${BEGIN}${instr(' OUTER ')}</w:r>`,
      `<w:r>${BEGIN}${instr(' INNER ')}${END}</w:r>`,
      `<w:r>${instr(' still outer ')}${END}</w:r>`,
    ].join('')
    const instructions = fieldInstructionsInXml(xml)
    expect(instructions).toContain(' INNER ')
    expect(instructions).toContain(' OUTER  still outer ')
  })

  it('decodes a fldSimple w:instr attribute', () => {
    const xml =
      '<w:fldSimple w:instr=" TA \\l &quot;[2020] UKSC 1&quot; \\c 1 "/>'
    expect(fieldInstructionsInXml(xml)).toEqual([
      ' TA \\l "[2020] UKSC 1" \\c 1 ',
    ])
  })

  it('decodes entities inside instrText', () => {
    const xml = `<w:r>${BEGIN}${instr(' TA \\l &quot;a &amp; b&quot; ')}${END}</w:r>`
    expect(fieldInstructionsInXml(xml)).toEqual([' TA \\l "a & b" '])
  })

  it("emits an unclosed field's partial instruction", () => {
    const xml = `<w:r>${BEGIN}${instr(' TOA \\h ')}</w:r>`
    expect(fieldInstructionsInXml(xml)).toEqual([' TOA \\h '])
  })
})
