export function selectionAnnouncement(paragraphCount: number) {
  if (paragraphCount <= 0) return ''
  if (paragraphCount === 1) return '1 paragraph selected.'
  return `${String(paragraphCount)} paragraphs selected. Character formatting applies to the whole selection.`
}
