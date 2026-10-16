import { downloadBlob } from '../../document-edits'
import { fetchDocumentExport } from '../../document-workspace-api'
import { mutationError } from './workspace-chrome'

/**
 * Exports the stored document as DOCX and returns the message to show, or null
 * when nothing needs saying. Split from `docx-workspace.tsx`, which is at the
 * source ceiling; the caller owns the banner state.
 *
 * The saved name comes from the response's own Content-Disposition so a
 * non-ASCII filename the server normalised lands as the exact name the server
 * chose; the document's display name is only the fallback. `shareSafe` asks
 * for the metadata-stripped variant — the server refuses with a reason rather
 * than emit a file it cannot prove clean.
 */
export async function exportDocumentAsDocx(
  documentId: string,
  filename: string,
  options?: { shareSafe?: boolean },
): Promise<string | null> {
  try {
    const {
      blob,
      skippedCommentCount,
      filename: served,
    } = await fetchDocumentExport(documentId, { shareSafe: options?.shareSafe })
    const name = served ?? filename
    downloadBlob(/\.docx$/iu.test(name) ? name : `${name}.docx`, blob)
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
