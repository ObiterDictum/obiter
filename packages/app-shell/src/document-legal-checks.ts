/**
 * The shared shape the document-workspace legal checks report: a problem a
 * person should look at, not a verdict. `issue` names something broken — a
 * reference with no target, a duplicated definition — while `review` names
 * honest uncertainty or a drafting fact worth a look — a stale field result,
 * a term used before it is defined, a quoted phrase that was never marked.
 */
export type LegalCheckFinding = {
  id: string
  /** The paragraph the finding navigates to, when the wire names one. */
  paragraphId: string | null
  /**
   * True when the finding names an unsaved draft rather than stored
   * content, so the panel can label it pending rather than imply the saved
   * document is already wrong.
   */
  pending: boolean
  severity: 'issue' | 'review'
  message: string
}
