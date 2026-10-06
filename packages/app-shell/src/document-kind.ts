export type WorkspaceKind = 'docx' | 'pdf' | 'txt' | 'other'

export function workspaceKind(
  fileType: string | null | undefined,
): WorkspaceKind {
  const value = fileType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (
    value === 'docx' ||
    value === '.docx' ||
    value ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx'
  }
  if (value === 'pdf' || value === '.pdf' || value === 'application/pdf') {
    return 'pdf'
  }
  if (value === 'txt' || value === '.txt' || value === 'text/plain') {
    return 'txt'
  }
  return 'other'
}
