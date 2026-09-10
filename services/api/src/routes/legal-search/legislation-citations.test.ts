import { describe, expect, it } from 'vitest'
import {
  classifyLegislationCitation,
  createActDirectory,
  formatProvisionDisplayLabel,
  parseScheduleLabelPath,
  parseSectionLabelPath,
  type LegislationActDirectoryEntry,
} from './legislation-citations'

const entries: LegislationActDirectoryEntry[] = [
  {
    actType: 'ukpga',
    year: 1998,
    number: 42,
    identity: 'ukpga/1998/42',
    title: 'Human Rights Act 1998',
  },
  {
    actType: 'ukpga',
    year: 2010,
    number: 15,
    identity: 'ukpga/2010/15',
    title: 'Equality Act 2010',
  },
  {
    actType: 'ukpga',
    year: 2020,
    number: 1,
    identity: 'ukpga/2020/1',
    title: 'Sample Act 2020',
  },
]

const directory = createActDirectory(entries)

describe('classifyLegislationCitation', () => {
  it.each(['constructor', '__proto__', 'toString', 'valueOf'])(
    'does not treat the inherited Object property %s as an alias',
    (query) => {
      // `actAliases` used to be an object literal, so `actAliases['constructor']`
      // resolved to `Object` and was truthy, throwing in normalizeActTitle for
      // the bare query `constructor`. An inherited name must be unrecognised.
      expect(classifyLegislationCitation(query, directory).kind).toBe(
        'unrecognised',
      )
    },
  )

  it('still resolves the curated alias', () => {
    expect(classifyLegislationCitation('HRA 1998', directory).kind).toBe('act')
  })
  it('resolves chapter numbers', () => {
    const outcome = classifyLegislationCitation('1998 c.42', directory)
    expect(outcome).toEqual({
      kind: 'act',
      act: {
        actType: 'ukpga',
        year: 1998,
        number: 42,
        identity: 'ukpga/1998/42',
        title: 'Human Rights Act 1998',
      },
      recognisedQuery: '1998 c.42',
    })
  })

  it('resolves short titles', () => {
    const outcome = classifyLegislationCitation('Equality Act 2010', directory)
    expect(outcome.kind).toBe('act')
    if (outcome.kind === 'act')
      expect(outcome.act.identity).toBe('ukpga/2010/15')
  })

  it('resolves aliases', () => {
    const outcome = classifyLegislationCitation('HRA 1998', directory)
    expect(outcome.kind).toBe('act')
    if (outcome.kind === 'act')
      expect(outcome.act.identity).toBe('ukpga/1998/42')
  })

  it('resolves section forms with the Act after the number', () => {
    const outcome = classifyLegislationCitation('s 6 HRA 1998', directory)
    expect(outcome.kind).toBe('provision')
    if (outcome.kind === 'provision') {
      expect(outcome.provision.provisionId).toBe('ukpga/1998/42/section/6')
      expect(outcome.provision.label).toBe('s. 6')
    }
  })

  it('resolves section forms with the Act first', () => {
    const outcome = classifyLegislationCitation(
      'section 6 Human Rights Act 1998',
      directory,
    )
    expect(outcome.kind).toBe('provision')
    if (outcome.kind === 'provision') {
      expect(outcome.provision.provisionId).toBe('ukpga/1998/42/section/6')
    }
  })

  it('resolves nested subsections', () => {
    const outcome = classifyLegislationCitation(
      's 13(2)(a) Sample Act 2020',
      directory,
    )
    expect(outcome.kind).toBe('provision')
    if (outcome.kind === 'provision') {
      expect(outcome.provision.provisionId).toBe('ukpga/2020/1/section/13/2/a')
      expect(outcome.provision.label).toBe('s. 13(2)(a)')
    }
  })

  it('resolves schedule forms', () => {
    const outcome = classifyLegislationCitation(
      'Schedule 2 paragraph 4 Sample Act 2020',
      directory,
    )
    expect(outcome.kind).toBe('provision')
    if (outcome.kind === 'provision') {
      expect(outcome.provision.provisionId).toBe(
        'ukpga/2020/1/schedule/2/paragraph/4',
      )
    }
  })

  it('leaves a bare section number unrecognised instead of guessing an Act', () => {
    expect(classifyLegislationCitation('s 13(2)(a)', directory)).toEqual({
      kind: 'unrecognised',
    })
  })

  it('leaves unknown Acts unrecognised', () => {
    expect(
      classifyLegislationCitation('s 6 Imaginary Act 1998', directory),
    ).toEqual({ kind: 'unrecognised' })
    expect(
      classifyLegislationCitation('Donoghue v Stevenson', directory),
    ).toEqual({
      kind: 'unrecognised',
    })
  })

  it('reports ambiguity with candidates instead of a silent winner', () => {
    const rival = createActDirectory([
      ...entries,
      {
        actType: 'ukpga',
        year: 2006,
        number: 48,
        identity: 'ukpga/2006/48',
        title: 'Sample Act 2020',
      },
    ])
    const outcome = classifyLegislationCitation('Sample Act 2020', rival)
    expect(outcome.kind).toBe('ambiguous')
    if (outcome.kind === 'ambiguous') {
      expect(outcome.candidates).toHaveLength(2)
      expect(outcome.reason).toContain('more than one')
    }
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

  it('formats display labels', () => {
    expect(formatProvisionDisplayLabel('section/13/2/a')).toBe('s. 13(2)(a)')
    expect(formatProvisionDisplayLabel('schedule/2/paragraph/4')).toBe(
      'Sch. 2 para. 4',
    )
  })
})
