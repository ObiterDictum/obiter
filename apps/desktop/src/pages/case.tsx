import { AtlasCaseView } from '@ormont/app-shell'

export function DesktopCasePage({ caseId }: { caseId: string }) {
  return <AtlasCaseView caseId={caseId} />
}
