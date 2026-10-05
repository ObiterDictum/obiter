import { downloadBlob } from '../../document-edits'
import { fetchDocumentExport } from '../../document-workspace-api'
import { mutationError } from './workspace-chrome'

/**
 * Exports the stored document as DOCX and returns the message to show, or null
 * when nothing needs saying. Split from `docx-workspace.tsx`, which is at the
 * source ceiling; the caller owns the banner state.
 */
export async function exportDocumentAsDocx(
  documentId: string,
  filename: string,
): Promise<string | null> {
  try {
    const { blob, skippedCommentCount } = await fetchDocumentExport(documentId)
    downloadBlob(
      /\.docx$/iu.test(filename) ? filename : `${filename}.docx`,
      blob,
    )
    return skippedCommentCount > 0
      ? skippedCommentsMessage(skippedCommentCount)
      : null
  } catch (error) {
    return mutationError(error)
  }
}

function skippedCommentsMessage(count: number) {
  return count === 1
    ? '1 comment could not be placed in the exported document and was skipped.'
    : `${String(count)} comments could not be placed in the exported document and were skipped.`
}
