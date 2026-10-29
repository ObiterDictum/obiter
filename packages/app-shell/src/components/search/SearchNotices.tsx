import { Card, CardBody } from '@obiter/ui'
import {
  getLegislationScheduleGuidanceFeedback,
  getLegislationScheduleResubmitQuery,
} from './legislationGuidance'
import type { LegalSearchFetchResponse } from './searchTypes'

export function SearchNotices({
  response,
  onResubmit,
}: {
  response: LegalSearchFetchResponse
  onResubmit?: (query: string) => void
}) {
  const legislationNote = response.diagnostics?.legislationNote
  const guidance = response.diagnostics?.legislationScheduleGuidance
  const guidanceFeedback = guidance
    ? getLegislationScheduleGuidanceFeedback(guidance)
    : null
  const resubmitQuery = guidance
    ? getLegislationScheduleResubmitQuery(guidance)
    : null
  const legislationVerdict =
    Boolean(guidance) ||
    ((response.diagnostics?.legislationNotHeld === true ||
      response.diagnostics?.legislationTitleUnresolved === true ||
      response.diagnostics?.legislationAmbiguous === true) &&
      Boolean(legislationNote))
  const judgmentFailed = response.diagnostics?.judgmentSearchFailed === true
  const legislationFailed =
    response.diagnostics?.legislationSearchFailed === true
  const hasLegislation = (response.groups ?? []).some(
    (group) => group.hits.length > 0,
  )

  return (
    <>
      {judgmentFailed || legislationFailed ? (
        <Card role="status">
          <CardBody className="pt-6 text-body text-muted">
            {incompleteCoverageMessage(judgmentFailed, legislationFailed)}
          </CardBody>
        </Card>
      ) : null}
      {legislationVerdict && !hasLegislation ? (
        <Card role="status">
          <CardBody className="flex flex-col gap-2 pt-6 text-body text-muted">
            <p>{guidanceFeedback ? guidanceFeedback.body : legislationNote}</p>
            {resubmitQuery && onResubmit ? (
              <button
                type="button"
                className="w-fit font-medium text-brand hover:underline"
                onClick={() => onResubmit(resubmitQuery)}
              >
                Use this citation
              </button>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </>
  )
}

function incompleteCoverageMessage(
  judgmentSearchFailed: boolean,
  legislationSearchFailed: boolean,
) {
  if (judgmentSearchFailed && legislationSearchFailed) {
    return 'Part of this search failed, so these results may be incomplete.'
  }
  if (legislationSearchFailed) {
    return 'Legislation could not be searched this time, so these results may be incomplete.'
  }
  return 'Case law could not be searched this time, so these results may be incomplete.'
}
