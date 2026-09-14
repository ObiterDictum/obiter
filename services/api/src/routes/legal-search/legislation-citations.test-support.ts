import {
  createActDirectory,
  type LegislationActDirectoryEntry,
} from './legislation-citations'

/**
 * The stored Act directory the citation-classification tests resolve against.
 * Defined once and shared by the split test files so the fixture cannot drift
 * between them. Titles are chosen so each fold under test (case, quote, hyphen,
 * `(repealed)`, alias) has exactly one stored Act to converge on.
 */
export const entries: LegislationActDirectoryEntry[] = [
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
  // Real titles whose lowercase joining words (`of`, `and`) teach the
  // directory what a short title may contain. Without them the classifier has
  // no title grammar to read and can only fall back on containment.
  {
    actType: 'ukpga',
    year: 2023,
    number: 42,
    identity: 'ukpga/2023/42',
    title: 'Powers of Attorney Act 2023',
  },
  {
    actType: 'ukpga',
    year: 2022,
    number: 32,
    identity: 'ukpga/2022/32',
    title: 'Police, Crime, Sentencing and Courts Act 2022',
  },
]

export const directory = createActDirectory(entries)
