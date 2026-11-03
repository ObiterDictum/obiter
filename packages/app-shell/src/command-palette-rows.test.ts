import { describe, expect, it } from 'bun:test'
import {
  buildPalette,
  flattenPalette,
  paletteScore,
  type PaletteInput,
  type PaletteRow,
} from './command-palette-rows'

const matters = [
  {
    id: 'mtr_1',
    name: 'Smith v Jones Lettings Ltd',
    clientReference: 'HP-2026-0412',
    updatedAt: '2026-10-02T09:00:00.000Z',
  },
  {
    id: 'mtr_2',
    name: 'Ashcroft Probate',
    clientReference: null,
    updatedAt: '2026-10-05T09:00:00.000Z',
  },
]

const documents = [
  {
    documentId: 'doc_1',
    matterId: 'mtr_1',
    matterName: 'Smith v Jones Lettings Ltd',
    filename: 'Defence and Counterclaim.docx',
    openedAt: '2026-10-06T09:00:00.000Z',
  },
  {
    documentId: 'doc_2',
    matterId: 'mtr_2',
    matterName: 'Ashcroft Probate',
    filename: 'Attendance note.txt',
    openedAt: '2026-10-04T09:00:00.000Z',
  },
]

const actions: PaletteRow[] = [
  {
    id: 'action-toggle-nav',
    label: 'Toggle sidebar',
    hint: 'Show or hide the navigation',
    shortcut: 'toggle-nav',
    target: { kind: 'action', id: 'toggle-nav' },
  },
  {
    id: 'action-toggle-theme',
    label: 'Switch to dark theme',
    hint: 'Change how Obiter looks',
    target: { kind: 'action', id: 'toggle-theme' },
  },
]

function input(overrides: Partial<PaletteInput> = {}): PaletteInput {
  return {
    query: '',
    matters,
    documents,
    verificationRuns: [],
    redactionRuns: [],
    recentlyOpenedDocumentId: null,
    currentMatterName: null,
    actions,
    ...overrides,
  }
}

function labels(groupRows: PaletteRow[]) {
  return groupRows.map((row) => row.label)
}

describe('command palette results', () => {
  it('leads with the recently opened document and recent matters when the input is empty', () => {
    const groups = buildPalette(input({ recentlyOpenedDocumentId: 'doc_1' }))
    const recent = groups[0]
    expect(recent?.id).toBe('recent')
    expect(labels(recent?.rows ?? [])).toEqual([
      'Defence and Counterclaim.docx',
      'Ashcroft Probate',
      'Smith v Jones Lettings Ltd',
    ])
  })

  it('hides the go-to group and the law search row until something is typed', () => {
    const groups = buildPalette(input())
    expect(groups.map((group) => group.id)).toEqual([
      'recent',
      'create',
      'actions',
    ])
  })

  it('finds a matter by its client reference', () => {
    const groups = buildPalette(input({ query: 'HP-2026' }))
    const goTo = groups.find((group) => group.id === 'go-to')
    expect(labels(goTo?.rows ?? [])).toContain('Smith v Jones Lettings Ltd')
  })

  it('finds a document by its filename and names the matter it sits in', () => {
    const groups = buildPalette(input({ query: 'defence' }))
    const goTo = groups.find((group) => group.id === 'go-to')
    expect(goTo?.rows[0]?.label).toBe('Defence and Counterclaim.docx')
    expect(goTo?.rows[0]?.hint).toBe('Smith v Jones Lettings Ltd')
  })

  it('keeps a Verify run as a row that opens the Verify screen', () => {
    const groups = buildPalette(
      input({
        query: 'defence',
        verificationRuns: [
          {
            id: 'run_1',
            matterId: 'mtr_1',
            documentId: 'doc_1',
            status: 'completed',
            createdAt: '2026-10-06T09:00:00.000Z',
          },
        ],
      }),
    )
    const row = flattenPalette(groups).find(
      (candidate) => candidate.target.kind === 'verify',
    )
    expect(row?.label).toBe('Defence and Counterclaim.docx')
    expect(row?.hint).toBe('Verify · completed')
  })

  it('opens a redaction run by id from the input', () => {
    const groups = buildPalette(
      input({
        query: 'witness',
        redactionRuns: [
          {
            id: 'red_1',
            sourceFilename: 'witness-statement.pdf',
            matterName: 'Smith v Jones Lettings Ltd',
            updatedAt: '2026-10-06T09:00:00.000Z',
          },
        ],
      }),
    )
    const row = flattenPalette(groups).find(
      (candidate) => candidate.target.kind === 'redaction',
    )
    expect(row?.target).toEqual({ kind: 'redaction', runId: 'red_1' })
  })

  it('builds the law search row from the typed query and keeps its capitalisation', () => {
    const groups = buildPalette(input({ query: '  Unfair Dismissal  ' }))
    const law = groups.find((group) => group.id === 'law')
    expect(law?.rows).toHaveLength(1)
    expect(law?.rows[0]?.target).toEqual({
      kind: 'law',
      query: 'Unfair Dismissal',
    })
  })

  it('says when an upload goes into the open matter and asks which matter otherwise', () => {
    const inMatter = flattenPalette(buildPalette(input()))
    const upload = inMatter.find((row) => row.id === 'upload-document')
    expect(upload?.hint).toBe('Choose a matter')

    const withMatter = flattenPalette(
      buildPalette(input({ currentMatterName: 'Ashcroft Probate' })),
    )
    expect(withMatter.find((row) => row.id === 'blank-document')?.hint).toBe(
      'Into Ashcroft Probate',
    )
  })

  it('shows the shortcut on the action rows that have one', () => {
    const rows = flattenPalette(
      buildPalette(input({ query: 'toggle sidebar' })),
    )
    expect(rows[0]?.shortcut).toBe('toggle-nav')
  })
})

describe('command palette scoring', () => {
  it('ranks a prefix match above a scattered subsequence', () => {
    expect(paletteScore('Matters', undefined, 'matt')).toBeGreaterThan(
      paletteScore('Matters', undefined, 'mtrs') ?? 0,
    )
  })

  it('returns no score when a letter is missing', () => {
    expect(paletteScore('Matters', undefined, 'mattersx')).toBeNull()
  })
})
