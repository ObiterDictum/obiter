import { describe, expect, it } from 'bun:test'
import {
  classifyLegislationCitation,
  formatProvisionDisplayLabel,
  formatScheduleCitation,
  parseScheduleLabelPath,
  parseSectionLabelPath,
} from './legislation-citations'
import { directory } from './legislation-citations.test-support'
describe('citation form tolerance (finding 3)', () => {
  it.each([
    ['s. 20(3) Equality Act 2010', 'ukpga/2010/15/section/20/3'],
    ['s. 20 (3) Equality Act 2010', 'ukpga/2010/15/section/20/3'],
    ['s 20 (3) Equality Act 2010', 'ukpga/2010/15/section/20/3'],
    ['section 20(3) Equality Act 2010', 'ukpga/2010/15/section/20/3'],
    ['section 20 (3) Equality Act 2010', 'ukpga/2010/15/section/20/3'],
    ['section 20 subsection 3 Equality Act 2010', 'ukpga/2010/15/section/20/3'],
    ['s. 20 subsection 3 Equality Act 2010', 'ukpga/2010/15/section/20/3'],
  ])('resolves the spaced or worded section form %s', (query, expected) => {
    const outcome = classifyLegislationCitation(query, directory)
    expect(outcome.kind).toBe('provision')
    if (outcome.kind === 'provision') {
      expect(outcome.provision.provisionId).toBe(expected)
      expect(outcome.provision.label).toBe('s. 20(3)')
    }
  })

  it.each([
    ['Schedule 1 paragraph 2 Sample Act 2020', 'schedule/1/paragraph/2'],
    ['Sch. 1 para. 2 Sample Act 2020', 'schedule/1/paragraph/2'],
    ['Sch 1 para 2 Sample Act 2020', 'schedule/1/paragraph/2'],
    ['paragraph 2 Schedule 1 Sample Act 2020', 'schedule/1/paragraph/2'],
    ['para. 2 Sch. 1 Sample Act 2020', 'schedule/1/paragraph/2'],
  ])('resolves the schedule form %s', (query, expected) => {
    const outcome = classifyLegislationCitation(query, directory)
    expect(outcome.kind).toBe('provision')
    if (outcome.kind === 'provision') {
      expect(outcome.provision.labelPath).toBe(expected)
    }
  })

  it('resolves a schedule citation that names no schedule number', () => {
    // The unnumbered single-schedule storage path. The serve layer decides
    // whether the Act actually uses it; the parser must not drop the form.
    const outcome = classifyLegislationCitation(
      'Sch. para. 2 Sample Act 2020',
      directory,
    )
    expect(outcome.kind).toBe('provision')
    if (outcome.kind === 'provision') {
      expect(outcome.provision.labelPath).toBe('schedule/paragraph/2')
    }
  })

  it.each([
    's. 20 () Equality Act 2010',
    's. 20 (1)(2)(3)(4)(5)(6) Equality Act 2010',
    'Sch. 1 para. Sample Act 2020',
    'para. Schedule 1 Sample Act 2020',
    'Schedule 1 Sample Act 2020',
  ])('does not guess a provision for malformed input %s', (query) => {
    expect(classifyLegislationCitation(query, directory).kind).not.toBe(
      'provision',
    )
  })

  it('never passes an unrecognised citation prefix into title resolution', () => {
    // "s. 20 (3) Equalities Act 2010" has a misspelled Act: the provision
    // path must not be rebuilt from the leftover section text, and the Act
    // must be missing-provision, not a manufactured title.
    const outcome = classifyLegislationCitation(
      's. 20 (3) Equalities Act 2010',
      directory,
    )
    expect(['unrecognised', 'unresolved_title']).toContain(outcome.kind)
  })
})

describe('label parsing', () => {
  it('parses section and schedule paths', () => {
    expect(parseSectionLabelPath('13(2)(a)')).toBe('section/13/2/a')
    expect(parseSectionLabelPath('6')).toBe('section/6')
    expect(parseSectionLabelPath('banana')).toBeNull()
    expect(parseScheduleLabelPath('Schedule 2 paragraph 4')).toBe(
      'schedule/2/paragraph/4',
    )
    expect(parseScheduleLabelPath('Sch 2 para 4')).toBe(
      'schedule/2/paragraph/4',
    )
  })

  it('tolerates conventional spacing and word-order variants', () => {
    expect(parseSectionLabelPath('20 (3)')).toBe('section/20/3')
    expect(parseSectionLabelPath('20 subsection 3')).toBe('section/20/3')
    expect(parseScheduleLabelPath('para. 2 Sch. 1')).toBe(
      'schedule/1/paragraph/2',
    )
    expect(parseScheduleLabelPath('Sch. para. 2')).toBe('schedule/paragraph/2')
  })

  it('rejects empty, over-nested and misordered citations', () => {
    expect(parseSectionLabelPath('20 ()')).toBeNull()
    expect(parseSectionLabelPath('20 (1)(2)(3)(4)(5)(6)')).toBeNull()
    expect(parseScheduleLabelPath('Sch. 1 para. 2 para. 3')).toBeNull()
    expect(parseScheduleLabelPath('para. Schedule 1')).toBeNull()
  })

  it('formats display labels', () => {
    expect(formatProvisionDisplayLabel('section/13/2/a')).toBe('s. 13(2)(a)')
    expect(formatProvisionDisplayLabel('schedule/2/paragraph/4')).toBe(
      'Sch. 2 para. 4',
    )
    expect(formatProvisionDisplayLabel('schedule/paragraph/2')).toBe(
      'Sch. para. 2',
    )
  })
})

describe('schedule citation examples (finding 4)', () => {
  it.each([
    ['schedule/1/paragraph/2', 'Schedule 1 paragraph 2'],
    ['schedule/1/paragraph/2/3', 'Schedule 1 paragraph 2(3)'],
    ['schedule/12/paragraph/4A', 'Schedule 12 paragraph 4A'],
    ['schedule/paragraph/2', 'Schedule 1 paragraph 2'],
  ])('formats the label path %s as %s', (labelPath, expected) => {
    expect(formatScheduleCitation(labelPath)).toBe(expected)
  })

  it('round-trips numbered paths through the parser', () => {
    for (const labelPath of [
      'schedule/1/paragraph/2',
      'schedule/1/paragraph/2/3',
    ]) {
      const citation = formatScheduleCitation(labelPath)
      expect(citation).not.toBeNull()
      expect(parseScheduleLabelPath(citation ?? '')).toBe(labelPath)
    }
  })

  it('names the schedule a bare paragraph citation leaves out', () => {
    // The store only reports an unnumbered citation as underspecified on an
    // Act holding a numbered Schedule 1, so Schedule 1 is the example to give.
    const citation = formatScheduleCitation('schedule/paragraph/2')
    expect(citation).not.toBeNull()
    expect(parseScheduleLabelPath(citation ?? '')).toBe(
      'schedule/1/paragraph/2',
    )
  })

  it.each([
    'section/13',
    'schedule',
    'schedule/1',
    'schedule/1/part/2',
    'schedule/paragraph',
    'schedule/1/paragraph/2/()',
  ])('returns null for the non-schedule-paragraph path %s', (labelPath) => {
    expect(formatScheduleCitation(labelPath)).toBeNull()
  })
})
