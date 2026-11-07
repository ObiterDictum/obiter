export function escapeCitationHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] ?? character,
  )
}

export function formatJudgmentCitation(
  name: string,
  citation: string | null,
  first: number,
  last = first,
) {
  const pinpoint = first === last ? `[${first}]` : `[${first}]–[${last}]`
  const suffix = `${citation?.trim() ? ` ${citation.trim()}` : ''} ${pinpoint}`
  return {
    text: `${name}${suffix}`,
    html: `<i>${escapeCitationHtml(name)}</i>${escapeCitationHtml(suffix)}`,
  }
}
