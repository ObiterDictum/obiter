import { describe, expect, it } from 'vitest'
import {
  draftSystemPrompt,
  draftUserPrompt,
  labelSystemPrompt,
  labelUserPrompt,
} from './prompts'
import type { DocumentSpec } from './types'

const spec: DocumentSpec = {
  id: 'prompt-1',
  docType: 'witness_statement',
  requiredCategories: ['person_private', 'person_professional', 'email'],
  register: 'formal_pleading',
  difficulty: 'hard_negative',
  lengthWords: 500,
  seed: 'prompt:test',
  scenario: 'A fictional tenancy dispute.',
  hardNegatives: [
    {
      id: 'negative:citation',
      kind: 'neutral_citation',
      quote: '[2099] EWHC 101 (KB)',
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: ['case_reference'],
    },
    {
      id: 'negative:damages',
      kind: 'damages_figure',
      quote: '£100001',
      occurrence: 1,
      expectedCount: 1,
      mustNotOverlap: ['case_reference'],
    },
  ],
  matrixCells: [],
}

describe('synthetic-v2 prompts', () => {
  it('keeps drafting plain while requiring role-aware structured offsets', () => {
    expect(draftSystemPrompt).toContain('Do not output labels')
    expect(labelSystemPrompt).toContain('person_professional')
    expect(labelSystemPrompt).toContain('UTF-16 offsets')
    expect(labelSystemPrompt).toContain('Do not return XML')
  })

  it('turns every requested category and hard negative into an explicit requirement', () => {
    const prompt = draftUserPrompt(spec)
    expect(prompt).toContain('person_private: a private person')
    expect(prompt).toContain('person_professional: a named legal')
    expect(prompt).toContain('email: a fictional .test email address')
    expect(prompt).toContain('Hard-negative literals:')
    expect(prompt).toContain('[2099] EWHC 101 (KB)')
    expect(labelUserPrompt(spec, 'Fictional text.')).toContain(
      'Immutable document source',
    )
  })
})
