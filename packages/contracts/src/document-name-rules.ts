export const DOCUMENT_NAME_MAX_LENGTH = 200

export const DEFAULT_DOCUMENT_NAME = 'Untitled document'

const forbiddenDocumentNameCharacter = /[/\\\p{Cc}]/u

export type DocumentNameCheck =
  { ok: true; name: string } | { ok: false; error: string }

export function checkDocumentName(
  input: string,
  extension?: string,
): DocumentNameCheck {
  const trimmed = input.trim()
  const suffix = extension ? `.${extension.toLowerCase()}` : ''
  const name =
    suffix && trimmed.toLowerCase().endsWith(suffix)
      ? trimmed.slice(0, -suffix.length).trimEnd()
      : trimmed
  if (!name) return { ok: false, error: 'Enter a document name.' }
  if (name.length > DOCUMENT_NAME_MAX_LENGTH)
    return {
      ok: false,
      error: `Use ${DOCUMENT_NAME_MAX_LENGTH} characters or fewer.`,
    }
  if (forbiddenDocumentNameCharacter.test(name))
    return {
      ok: false,
      error: 'Names cannot contain slashes or control characters.',
    }
  return { ok: true, name }
}
