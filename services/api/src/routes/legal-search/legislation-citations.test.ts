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

  it('reports an unresolved Act-shaped title without claiming it is not held', () => {
    // A failed title lookup proves only that no exact title key matched: the
    // directory is partial and the fold is imperfect, so it cannot prove the
    // Act is absent. The honest state suppresses unrelated keyword provisions
    // but makes no claim about the Act itself.
    expect(
      classifyLegislationCitation('s 6 Imaginary Act 1998', directory),
    ).toEqual({
      kind: 'unresolved_title',
      recognisedQuery: 's 6 Imaginary Act 1998',
    })
    expect(classifyLegislationCitation('Children Act 1989', directory)).toEqual(
      {
        kind: 'unresolved_title',
        recognisedQuery: 'Children Act 1989',
      },
    )
  })

  it('never derives not_held from a failed title lookup alone', () => {
    // Finding 1 root defect: byNormalizedTitle returning no rows was treated
    // as proof the Act does not exist. Build a directory whose title map is
    // empty for a title-shaped query and prove the outcome is not `not_held`.
    const emptyTitleDirectory = createActDirectory([
      {
        actType: 'ukpga',
        year: 2010,
        number: 15,
        identity: 'ukpga/2010/15',
        title: 'Equality Act 2010',
      },
    ])
    expect(
      classifyLegislationCitation(
        'Some Unstored Act 1999',
        emptyTitleDirectory,
      ),
    ).not.toMatchObject({ kind: 'not_held' })
  })

  it('still reports an absent canonical chapter as not held', () => {
    // A parsed chapter citation is a canonical identity: year and number
    // prove what was requested, so the store proves it is absent.
    expect(classifyLegislationCitation('2008 c. 12', directory)).toEqual({
      kind: 'not_held',
      recognisedQuery: '2008 c. 12',
    })
  })

  it('treats a prose clause ending in an Act citation as a subject query', () => {
    // Finding 3: a sentence that merely ends in a citation is not a
    // whole-title request. It must stay eligible for keyword search.
    expect(
      classifyLegislationCitation(
        'defences under the Children Act 1989',
        directory,
      ),
    ).toEqual({ kind: 'unrecognised' })
    expect(
      classifyLegislationCitation(
        'offences contrary to the Computer Misuse Act 1990',
        directory,
      ),
    ).toEqual({ kind: 'unrecognised' })
  })

  it('does not treat an underspecified Act fragment as a title request', () => {
    // "Act 2020" carries no title words, so it cannot support a not-held
    // assertion or an exact-title claim.
    expect(classifyLegislationCitation('Act 2020', directory)).toEqual({
      kind: 'unrecognised',
    })
  })

  it('still leaves non-Act text unrecognised', () => {
    expect(
      classifyLegislationCitation('Donoghue v Stevenson', directory),
    ).toEqual({
      kind: 'unrecognised',
    })
    // A phrase that merely shares a word with a title is not an Act citation.
    expect(classifyLegislationCitation('proportionality', directory)).toEqual({
      kind: 'unrecognised',
    })
  })

  it('reports an unheld chapter number as not held', () => {
    expect(classifyLegislationCitation('2008 c. 12', directory)).toEqual({
      kind: 'not_held',
      recognisedQuery: '2008 c. 12',
    })
  })

  it('folds curly and straight quotes to the same Act title', () => {
    const renters = createActDirectory([
      {
        actType: 'ukpga',
        year: 2025,
        number: 26,
        identity: 'ukpga/2025/26',
        title: 'Renters’ Rights Act 2025',
      },
    ])
    // The stored title carries U+2019; the straight apostrophe is what a UK
    // keyboard produces. Both must resolve, or one form merely shifts the
    // miss to the other apostrophe.
    for (const query of [
      'Renters’ Rights Act 2025',
      "Renters' Rights Act 2025",
    ]) {
      const outcome = classifyLegislationCitation(query, renters)
      expect(outcome.kind).toBe('act')
      if (outcome.kind === 'act') {
        expect(outcome.act.identity).toBe('ukpga/2025/26')
      }
    }
  })

  it('folds non-breaking spaces and dash variants to the same Act title', () => {
    const stored = createActDirectory([
      ...entries,
      {
        actType: 'ukpga',
        year: 2021,
        number: 12,
        identity: 'ukpga/2021/12',
        title: 'High Speed Rail (West Midlands – Crewe) Act 2021',
      },
    ])
    // The stored title carries an en dash; pasted text carries a hyphen and
    // a non-breaking space. Both sides fold through the same map.
    const outcome = classifyLegislationCitation(
      'High Speed Rail (West Midlands\u00A0- Crewe) Act 2021',
      stored,
    )
    expect(outcome.kind).toBe('act')
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

  it('resolves every canonical short title whose stored title carries (repealed)', () => {
    // Finding 1: the stored title carries a terminal status annotation the
    // canonical citation never does, so the canonical title answered "not
    // held" while the chapter citation resolved the same document.
    const repealed = createActDirectory([
      {
        actType: 'ukpga',
        year: 2021,
        number: 28,
        identity: 'ukpga/2021/28',
        title: 'Health and Social Care Levy Act 2021 (repealed)',
      },
      {
        actType: 'ukpga',
        year: 2021,
        number: 13,
        identity: 'ukpga/2021/13',
        title: 'Non-Domestic Rating (Public Lavatories) Act 2021 (repealed)',
      },
      {
        actType: 'ukpga',
        year: 2023,
        number: 9,
        identity: 'ukpga/2023/9',
        title: 'Trade (Australia and New Zealand) Act 2023 (repealed)',
      },
      {
        actType: 'ukpga',
        year: 2023,
        number: 39,
        identity: 'ukpga/2023/39',
        title: 'Strikes (Minimum Service Levels) Act 2023 (repealed)',
      },
      {
        actType: 'ukpga',
        year: 2023,
        number: 46,
        identity: 'ukpga/2023/46',
        title: 'Workers (Predictable Terms and Conditions) Act 2023 (repealed)',
      },
      {
        actType: 'ukpga',
        year: 2024,
        number: 8,
        identity: 'ukpga/2024/8',
        title: 'Safety of Rwanda (Asylum and Immigration) Act 2024 (repealed)',
      },
    ])
    const canonical = [
      ['Health and Social Care Levy Act 2021', 'ukpga/2021/28'],
      ['Non-Domestic Rating (Public Lavatories) Act 2021', 'ukpga/2021/13'],
      ['Trade (Australia and New Zealand) Act 2023', 'ukpga/2023/9'],
      ['Strikes (Minimum Service Levels) Act 2023', 'ukpga/2023/39'],
      ['Workers (Predictable Terms and Conditions) Act 2023', 'ukpga/2023/46'],
      ['Safety of Rwanda (Asylum and Immigration) Act 2024', 'ukpga/2024/8'],
    ] as const
    for (const [query, identity] of canonical) {
      const outcome = classifyLegislationCitation(query, repealed)
      expect(outcome.kind).toBe('act')
      if (outcome.kind === 'act') expect(outcome.act.identity).toBe(identity)
    }
  })

  it('resolves reported punctuation and wording variants of held titles', () => {
    // Orthographic variants lawyers actually type: a dropped apostrophe, a
    // dropped or spaced hyphen, '&' typed as 'and', and a dropped 'etc'.
    // None may answer "not held" for an Act the corpus holds.
    const variants = createActDirectory([
      {
        actType: 'ukpga',
        year: 2026,
        number: 21,
        identity: 'ukpga/2026/21',
        title: 'Children’s Wellbeing and Schools Act 2026',
      },
      {
        actType: 'ukpga',
        year: 2023,
        number: 18,
        identity: 'ukpga/2023/18',
        title: 'Carer’s Leave Act 2023',
      },
      {
        actType: 'ukpga',
        year: 2022,
        number: 21,
        identity: 'ukpga/2022/21',
        title: 'Skills and Post-16 Education Act 2022',
      },
      {
        actType: 'ukpga',
        year: 2021,
        number: 8,
        identity: 'ukpga/2021/8',
        title: 'Non-Domestic Rating (Lists) Act 2021',
      },
      {
        actType: 'ukpga',
        year: 2023,
        number: 23,
        identity: 'ukpga/2023/23',
        title: 'Co-operatives, Mutuals and Friendly Societies Act 2023',
      },
      {
        actType: 'ukpga',
        year: 2021,
        number: 29,
        identity: 'ukpga/2021/29',
        title:
          'Compensation (London Capital & Finance plc and Fraud Compensation Fund) Act 2021',
      },
      {
        actType: 'ukpga',
        year: 2025,
        number: 29,
        identity: 'ukpga/2025/29',
        title: 'Property (Digital Assets etc) Act 2025',
      },
      {
        actType: 'ukpga',
        year: 2020,
        number: 23,
        identity: 'ukpga/2020/23',
        title: 'Social Security (Up-rating of Benefits) Act 2020',
      },
      {
        actType: 'ukpga',
        year: 2024,
        number: 6,
        identity: 'ukpga/2024/6',
        title:
          'Trade (Comprehensive and Progressive Agreement for Trans-Pacific Partnership) Act 2024',
      },
      {
        actType: 'ukpga',
        year: 2021,
        number: 2,
        identity: 'ukpga/2021/2',
        title: 'High Speed Rail (West Midlands - Crewe) Act 2021',
      },
    ])
    const cases = [
      ['Childrens Wellbeing and Schools Act 2026', 'ukpga/2026/21'],
      ['Carers Leave Act 2023', 'ukpga/2023/18'],
      ['Skills and Post 16 Education Act 2022', 'ukpga/2022/21'],
      ['Non Domestic Rating (Lists) Act 2021', 'ukpga/2021/8'],
      [
        'Cooperatives, Mutuals and Friendly Societies Act 2023',
        'ukpga/2023/23',
      ],
      [
        'Compensation (London Capital and Finance plc and Fraud Compensation Fund) Act 2021',
        'ukpga/2021/29',
      ],
      ['Property (Digital Assets) Act 2025', 'ukpga/2025/29'],
      ['Social Security (Uprating of Benefits) Act 2020', 'ukpga/2020/23'],
      [
        'Trade (Comprehensive and Progressive Agreement for Trans Pacific Partnership) Act 2024',
        'ukpga/2024/6',
      ],
      ['High Speed Rail (West Midlands Crewe) Act 2021', 'ukpga/2021/2'],
    ] as const
    for (const [query, identity] of cases) {
      const outcome = classifyLegislationCitation(query, variants)
      expect(outcome.kind).toBe('act')
      if (outcome.kind === 'act') expect(outcome.act.identity).toBe(identity)
    }
  })

  it('resolves a section form of a scanned title whose stored title is (repealed)', () => {
    const repealed = createActDirectory([
      {
        actType: 'ukpga',
        year: 2021,
        number: 28,
        identity: 'ukpga/2021/28',
        title: 'Health and Social Care Levy Act 2021 (repealed)',
      },
    ])
    const outcome = classifyLegislationCitation(
      's. 5 Health and Social Care Levy Act 2021',
      repealed,
    )
    expect(outcome.kind).toBe('provision')
    if (outcome.kind === 'provision') {
      expect(outcome.provision.provisionId).toBe('ukpga/2021/28/section/5')
    }
  })

  it('does not let a relaxed key silently pick one of two colliding titles', () => {
    const collision = createActDirectory([
      {
        actType: 'ukpga',
        year: 2020,
        number: 1,
        identity: 'ukpga/2020/1',
        title: 'Data (Use and Access) Act 2020',
      },
      {
        actType: 'ukpga',
        year: 2020,
        number: 2,
        identity: 'ukpga/2020/2',
        title: 'Data Use and Access Act 2020',
      },
    ])
    const outcome = classifyLegislationCitation(
      'Data (Use & Access) Act 2020',
      collision,
    )
    expect(outcome.kind).toBe('ambiguous')
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
