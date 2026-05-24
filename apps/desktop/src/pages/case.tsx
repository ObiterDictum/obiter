import { CaseLawDocumentView } from '@ormont/app-shell'

export function DesktopCasePage({ caseId }: { caseId: string }) {
  return <CaseLawDocumentView caseId={caseId} />
}
