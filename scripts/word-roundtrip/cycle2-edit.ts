import type { DocumentEditOperation } from '../../packages/contracts/src/document-edit'
import type { DocumentModelWire } from '../../packages/contracts/src/document-model'
import { documentBodyText } from './summary'

export type Cycle2EditPlan = {
  paragraphId: string
  runId: string
  operation: Extract<DocumentEditOperation, { type: 'replace_run_text' }>
  expectedBodyText: string
}

/**
 * The single deterministic edit cycle 2 applies through the real edit API
 * between the Word-labelled upload and the second export: one
 * `replace_run_text` appending a marker to the first plainly editable body
 * run. "Plainly editable" means outside every stored field's carrier
 * paragraphs and outside tracked-change markup — the targets an untracked
 * text replacement cannot disturb.
 *
 * `expectedBodyText` is the comparison oracle: the served model's body text
 * with only the addressed run's text changed. It is derived from the input
 * document and the declared operation, never from the exported output, so a
 * missing edit, a stale-version export or an edit landing on the wrong run
 * all produce an export that fails the expectation.
 */
export function planCycle2Edit(
  model: DocumentModelWire,
): Cycle2EditPlan | null {
  const skipParagraphs = new Set<string>()
  const skipRuns = new Set<string>()
  for (const story of model.stories) {
    for (const id of story.unanchoredFieldParagraphIds) {
      skipParagraphs.add(id)
    }
    for (const field of story.fields) {
      for (const id of field.boundaryIds) skipParagraphs.add(id)
      for (const id of field.paragraphIds) skipParagraphs.add(id)
    }
  }
  for (const change of model.changes) {
    if (change.paragraphId) skipParagraphs.add(change.paragraphId)
    if (change.runId) skipRuns.add(change.runId)
  }

  const story = model.stories.find((item) => item.kind === 'document')
  if (!story) return null
  for (const paragraph of story.paragraphs) {
    if (skipParagraphs.has(paragraph.id)) continue
    const run = paragraph.runs.find(
      (item) => item.text.length > 0 && !skipRuns.has(item.id),
    )
    if (!run) continue
    const text = `${run.text} [round-trip edit]`
    const paragraphs = story.paragraphs.map((candidate) =>
      candidate.id === paragraph.id
        ? {
            ...candidate,
            runs: candidate.runs.map((item) =>
              item.id === run.id ? { ...item, text } : item,
            ),
          }
        : candidate,
    )
    return {
      paragraphId: paragraph.id,
      runId: run.id,
      operation: { type: 'replace_run_text', runId: run.id, text },
      expectedBodyText: documentBodyText({
        model: { stories: [{ ...story, paragraphs }] },
      }),
    }
  }
  return null
}
