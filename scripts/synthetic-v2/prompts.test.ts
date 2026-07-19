import { describe, expect, it } from 'vitest'
import { systemPrompt, userPrompt } from './prompts'
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
  it('requires complete markers and preserves professional/public context', () => {
    expect(systemPrompt).toContain('person_professional')
    expect(systemPrompt).toContain(
      'Professional names remain person_professional',
    )
    expect(systemPrompt).toContain('Do not leave a dangling')
  })

  it('turns every requested category and hard negative into an explicit requirement', () => {
    const prompt = userPrompt(spec)
    expect(prompt).toContain('person_private: a private person')
    expect(prompt).toContain('person_professional: a named legal')
    expect(prompt).toContain('email: a fictional .test email address')
    expect(prompt).toContain('Hard negatives:')
  })
})
