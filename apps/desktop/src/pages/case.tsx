import { CaseLawDocumentView } from '@obiter/app-shell'

export function DesktopCasePage({ caseId }: { caseId: string }) {
  return <CaseLawDocumentView caseId={caseId} />
}
