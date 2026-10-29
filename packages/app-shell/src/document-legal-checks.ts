export type LegalCheckFinding = {
  id: string
  paragraphId: string | null
  pending: boolean
  severity: 'issue' | 'review'
  message: string
}
