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
  hardNegatives: ['a neutral citation', 'a damages figure'],
  matrixCells: [],
}

describe('synthetic-v2 prompts', () => {
  it('keeps drafting plain while requiring role-aware XML labelling', () => {
    expect(draftSystemPrompt).toContain('Do not output labels')
    expect(labelSystemPrompt).toContain('person_professional')
    expect(labelSystemPrompt).toContain('<pii category="category">')
  })

  it('turns every requested category and hard negative into an explicit requirement', () => {
    const prompt = draftUserPrompt(spec)
    expect(prompt).toContain('person_private: a private person')
    expect(prompt).toContain('person_professional: a named legal')
    expect(prompt).toContain('email: a fictional .test email address')
    expect(prompt).toContain('Hard negatives:')
    expect(labelUserPrompt(spec, 'Fictional text.')).toContain(
      'Document to annotate verbatim',
    )
  })
})
