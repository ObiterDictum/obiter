export type WorkspaceKind = 'docx' | 'pdf' | 'other'

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
  return 'other'
}
