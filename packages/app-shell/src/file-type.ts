export function declaredFileType(file: File): string {
  const extension = file.name.split('.').pop()?.trim().toLowerCase()
  return extension ? `.${extension}` : file.type
}
