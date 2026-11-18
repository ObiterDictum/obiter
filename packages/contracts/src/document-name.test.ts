import { expect, test } from 'bun:test'
import {
  DOCUMENT_NAME_MAX_LENGTH,
  documentNameSchema,
  documentRenameRequestSchema,
} from './document-name'

test('document names are trimmed before they are stored', () => {
  expect(documentNameSchema.parse('  Witness statement  ')).toBe(
    'Witness statement',
  )
})

test('document names reject blank, overlong, path and control input', () => {
  for (const name of [
    '',
    '   ',
    'a'.repeat(DOCUMENT_NAME_MAX_LENGTH + 1),
    'drafts/witness',
    'drafts\\witness',
    'line\nbreak',
    'nul\u0000byte',
  ]) {
    expect(documentNameSchema.safeParse(name).success).toBe(false)
  }
})

test('document names accept punctuation used in legal titles', () => {
  expect(
    documentNameSchema.safeParse('Smith v Jones [2024] EWHC 1 (Ch) – notes')
      .success,
  ).toBe(true)
})

test('rename requests carry only a name', () => {
  expect(
    documentRenameRequestSchema.safeParse({ name: 'A', filename: 'b' }).success,
  ).toBe(false)
})
