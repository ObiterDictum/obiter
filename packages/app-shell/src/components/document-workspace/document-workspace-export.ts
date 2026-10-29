import { downloadBlob } from '../../document-edits'
import { fetchDocumentExport } from '../../document-workspace-api'
import { refocusCaretBeforeFlight } from './document-actions'
import { mutationError } from './workspace-chrome'

async function exportDocumentAsDocx(
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

export function documentExportHandlers(
  documentId: string,
  filename: string,
  onNotice: (notice: string) => void,
) {
  const run = (options?: { shareSafe?: boolean }) => () => {
    refocusCaretBeforeFlight()
    void exportDocumentAsDocx(documentId, filename, options).then((message) => {
      if (message) onNotice(message)
    })
  }
  return { onExportText: run(), onExportShareSafe: run({ shareSafe: true }) }
}

function skippedCommentsMessage(count: number) {
  return count === 1
    ? '1 comment could not be placed in the exported document and was skipped.'
    : `${String(count)} comments could not be placed in the exported document and were skipped.`
}
