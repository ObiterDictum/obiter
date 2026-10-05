import { describe, expect, it } from 'bun:test'
import {
  buildOverrideFragment,
  hasPureStartOverride,
  levelStartOverride,
} from './numbering-edits'

describe('numbering override scanning', () => {
  it('does not fold a later override into a self-closing one', () => {
    const fragment =
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/>' +
      '<w:lvlOverride w:ilvl="0"/>' +
      '<w:lvlOverride w:ilvl="1"><w:startOverride w:val="7"/></w:lvlOverride>' +
      '</w:num>'
    // The self-closing override at ilvl 0 carries no start, so a 7 that belongs
    // to ilvl 1 must not make it look like a pure ilvl-0 restart.
    expect(hasPureStartOverride(fragment, 0, 7)).toBe(false)
    expect(levelStartOverride(fragment, 0)).toBeUndefined()
    expect(levelStartOverride(fragment, 1)).toBe(7)
  })

  it('emits startOverride before a redefined level and rewrites its start', () => {
    const source =
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/>' +
      '<w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:start w:val="5"/>' +
      '<w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1)"/></w:lvl>' +
      '</w:lvlOverride></w:num>'
    const fragment = buildOverrideFragment(source, 'w', '0', '2', 0, 3)
    expect(fragment.indexOf('<w:startOverride')).toBeGreaterThan(-1)
    expect(fragment.indexOf('<w:startOverride')).toBeLessThan(
      fragment.indexOf('<w:lvl '),
    )
    expect(fragment).toContain('<w:start w:val="3"/>')
    expect(fragment).not.toContain('<w:start w:val="5"/>')
  })
})
