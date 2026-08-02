import type { LegalSearchFilters } from '../index'
import { shortWordExpectedId, shortWordFixtures } from './fixtures'

export type SearchBenchmarkCategory =
  | 'exact_citation'
  | 'malformed_citation'
  | 'ambiguous_citation'
  | 'case_title'
  | 'party_names'
  | 'provider_document_id'
  | 'body_text_phrase'
  | 'no_answer'
  | 'court_filtered_browse'
  | 'date_filtered_query'
  | 'short_word_precision'
  | 'content_word_recall'
  | 'free_text_court_code'

export interface SearchBenchmarkCase {
  id: string
  category: SearchBenchmarkCategory
  query: string
  filters?: LegalSearchFilters
  expectedTopId?: string
  expectedCandidateIds?: string[]
  expectedNoResults?: boolean
  expectedResults?: boolean
  expectsEvidence?: boolean
}

const objectiveCases: SearchBenchmarkCase[] = [
  {
    id: 'citation-uksc-2024-3',
    category: 'exact_citation',
    query: '[2024] UKSC 3',
    expectedTopId: 'uksc-2024-3',
  },
  {
    id: 'citation-uksc-2023-28',
    category: 'exact_citation',
    query: '[2023] UKSC 28',
    expectedTopId: 'uksc-2023-28',
  },
  {
    id: 'citation-ewca-2022-159',
    category: 'exact_citation',
    query: '[2022] EWCA Civ 159',
    expectedTopId: 'ewca-civ-2022-159',
  },
  {
    id: 'citation-admin-2021-123',
    category: 'exact_citation',
    query: '[2021] EWHC 123 (Admin)',
    expectedTopId: 'ewhc-admin-2021-123',
  },
  {
    id: 'malformed-missing-bracket',
    category: 'malformed_citation',
    query: '[2024 UKSC 3',
    expectedTopId: 'uksc-2024-3',
  },
  {
    id: 'malformed-reversed-brackets',
    category: 'malformed_citation',
    query: '2022] EWCA Civ 159[',
    expectedTopId: 'ewca-civ-2022-159',
  },
  {
    id: 'malformed-year-token',
    category: 'malformed_citation',
    query: '[20XX] UKSC banana',
    expectedNoResults: true,
  },
  {
    id: 'ambiguous-smith-jones',
    category: 'ambiguous_citation',
    query: 'Smith v Jones',
    expectedCandidateIds: ['ewhc-kb-2020-10', 'ewhc-kb-2018-20'],
  },
  {
    id: 'ambiguous-re-a',
    category: 'ambiguous_citation',
    query: 'Re A',
    expectedCandidateIds: ['ewfc-2022-1', 'ewca-civ-2021-2'],
  },
  {
    id: 'ambiguous-r-brown',
    category: 'ambiguous_citation',
    query: 'R v Brown',
    expectedCandidateIds: ['ewca-crim-1994-2', 'ewca-crim-1993-1'],
  },
  {
    id: 'title-potanina',
    category: 'case_title',
    query: 'Potanina v Potanin',
    expectedTopId: 'uksc-2024-3',
  },
  {
    id: 'title-paul',
    category: 'case_title',
    query: 'Paul v Royal Wolverhampton NHS Trust',
    expectedTopId: 'uksc-2023-28',
  },
  {
    id: 'title-green',
    category: 'case_title',
    query: 'Green v Secretary of State for Justice',
    expectedTopId: 'ewhc-admin-2021-123',
  },
  {
    id: 'title-accented',
    category: 'case_title',
    query: 'José Álvarez v Société Générale',
    expectedTopId: 'ewhc-ch-2019-77',
  },
  {
    id: 'title-umlaut',
    category: 'case_title',
    query: 'Müller v König GmbH',
    expectedTopId: 'ewhc-ch-2018-88',
  },
  {
    id: 'party-potanina',
    category: 'party_names',
    query: 'Potanina',
    expectedTopId: 'uksc-2024-3',
  },
  {
    id: 'party-wolverhampton',
    category: 'party_names',
    query: 'Royal Wolverhampton',
    expectedTopId: 'uksc-2023-28',
  },
  {
    id: 'party-rizwan',
    category: 'party_names',
    query: 'Rizwan',
    expectedTopId: 'ewca-civ-2022-159',
  },
  {
    id: 'party-jose-alvarez',
    category: 'party_names',
    query: 'José Álvarez',
    expectedTopId: 'ewhc-ch-2019-77',
  },
  {
    id: 'party-muller',
    category: 'party_names',
    query: 'Müller',
    expectedTopId: 'ewhc-ch-2018-88',
  },
  {
    id: 'document-id-uksc-2024',
    category: 'provider_document_id',
    query: 'uksc-2024-3',
    expectedTopId: 'uksc-2024-3',
  },
  {
    id: 'court-code-uksc',
    category: 'free_text_court_code',
    query: 'UKSC',
    expectedTopId: 'uksc-2024-3',
  },
  {
    id: 'court-code-ewca-civ',
    category: 'free_text_court_code',
    query: 'EWCA Civ',
    expectedTopId: 'ewca-civ-2022-159',
  },
  {
    id: 'court-code-admin',
    category: 'free_text_court_code',
    query: 'Admin',
    expectedTopId: 'ewhc-admin-2021-123',
  },
  {
    id: 'document-id-ewca-2022',
    category: 'provider_document_id',
    query: 'ewca-civ-2022-159',
    expectedTopId: 'ewca-civ-2022-159',
  },
  {
    id: 'document-id-admin-2021',
    category: 'provider_document_id',
    query: 'ewhc-admin-2021-123',
    expectedTopId: 'ewhc-admin-2021-123',
  },
  {
    id: 'document-id-ukut-2020',
    category: 'provider_document_id',
    query: 'ukut-aac-2020-99',
    expectedTopId: 'ukut-aac-2020-99',
  },
  {
    id: 'body-permission-proceedings',
    category: 'body_text_phrase',
    query: 'permission to bring proceedings',
    expectedTopId: 'uksc-2024-3',
    expectsEvidence: true,
  },
  {
    id: 'body-indivisible-injury',
    category: 'body_text_phrase',
    query: 'material contribution to an indivisible injury',
    expectedTopId: 'uksc-2023-28',
    expectsEvidence: true,
  },
  {
    id: 'body-duty-candour',
    category: 'body_text_phrase',
    query: 'duty of candour applied throughout',
    expectedTopId: 'ewhc-admin-2021-123',
    expectsEvidence: true,
  },
  {
    id: 'body-self-incrimination',
    category: 'body_text_phrase',
    query: 'self-incrimination protected',
    expectedTopId: 'ewca-crim-2024-44',
    expectsEvidence: true,
  },
  {
    id: 'body-proprietary-estoppel',
    category: 'body_text_phrase',
    query: 'proprietary estoppel clear assurance',
    expectedTopId: 'ewhc-ch-2017-55',
    expectsEvidence: true,
  },
  {
    id: 'no-answer-jurisdiction-leak',
    category: 'no_answer',
    query: 'england-and-wales',
    expectedNoResults: true,
  },
  {
    id: 'no-answer-short-typo',
    category: 'no_answer',
    query: 'claimnt',
    expectedNoResults: true,
  },
  {
    id: 'no-answer-specific-trailing-term',
    category: 'no_answer',
    query: 'permission application zygote',
    expectedNoResults: true,
  },
  {
    id: 'content-words-court-judgment-appeal',
    category: 'content_word_recall',
    query: 'court judgment appeal',
    expectedResults: true,
  },
  {
    id: 'no-answer-weak-tail',
    category: 'no_answer',
    query: 'material estoppel satellite',
    expectedNoResults: true,
  },
  {
    id: 'browse-uksc',
    category: 'court_filtered_browse',
    query: '',
    filters: { court: 'uksc' },
    expectedTopId: 'uksc-2024-3',
  },
  {
    id: 'browse-kings-bench',
    category: 'court_filtered_browse',
    query: '',
    filters: { court: 'ewhc-kb' },
    expectedTopId: 'ewhc-kb-2020-10',
  },
  {
    id: 'browse-criminal-appeal',
    category: 'court_filtered_browse',
    query: '',
    filters: { court: 'ewca-crim' },
    expectedTopId: 'ewca-crim-2024-44',
  },
  {
    id: 'date-smith-before-2019',
    category: 'date_filtered_query',
    query: 'Smith v Jones',
    filters: { dateTo: '2019-12-31' },
    expectedTopId: 'ewhc-kb-2018-20',
  },
  {
    id: 'date-brown-from-1994',
    category: 'date_filtered_query',
    query: 'R v Brown',
    filters: { dateFrom: '1994-01-01' },
    expectedTopId: 'ewca-crim-1994-2',
  },
  {
    id: 'date-potanina-2024',
    category: 'date_filtered_query',
    query: 'Potanina',
    filters: { dateFrom: '2024-01-01', dateTo: '2024-12-31' },
    expectedTopId: 'uksc-2024-3',
  },
]

const shortWordCases: SearchBenchmarkCase[] = shortWordFixtures.map(
  ([term]) => ({
    id: `short-word-${term}`,
    category: 'short_word_precision',
    query: term,
    expectedTopId: shortWordExpectedId(term),
  }),
)

export const searchBenchmarkCases = [...objectiveCases, ...shortWordCases]
