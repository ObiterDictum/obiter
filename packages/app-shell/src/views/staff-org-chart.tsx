import { useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@obiter/ui'
import type { StaffUsageOrganisation } from '@obiter/contracts'
import { SegmentedControl } from '../segmented-control'
import {
  ORG_METRICS,
  SERIES_COLOURS,
  formatCount,
  formatTick,
  orgBars,
  type OrgMetricKey,
} from './staff-chart-data'
import { OrganisationsTable, TableToggle } from './staff-usage-tables'

const BAR_COLOUR = SERIES_COLOURS[0]

function OrganisationBar({
  label,
  value,
  organisations,
  percent,
  metricLabel,
}: {
  label: string
  value: number
  organisations: number
  percent: number
  metricLabel: string
}) {
  const description = `${label}: ${formatCount(value)} ${metricLabel.toLowerCase()}${
    organisations > 1 ? ` across ${organisations} organisations` : ''
  }`
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-32 shrink-0 truncate text-meta text-ink @pane:w-44"
        title={label}
      >
        {label}
      </div>
      <div className="relative h-7 min-w-0 flex-1">
        {percent > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={description}
                  className="absolute inset-y-1 left-0 block rounded-r-sm transition-[filter] duration-150 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  style={{
                    width: `${percent}%`,
                    backgroundColor: BAR_COLOUR,
                  }}
                />
              }
            />
            <TooltipContent>{description}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}

export function OrganisationUsage({
  organisations,
}: {
  organisations: StaffUsageOrganisation[]
}) {
  const [metric, setMetric] = useState<OrgMetricKey>('activeUsers')
  const [showTable, setShowTable] = useState(false)
  const metricLabel =
    ORG_METRICS.find((item) => item.key === metric)?.label ?? ''
  const bars = orgBars(organisations, metric)
  const max = Math.max(1, ...bars.map((bar) => bar.value))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<OrgMetricKey>
          label="Organisation metric"
          value={metric}
          options={ORG_METRICS.map(({ key, label }) => ({
            value: key,
            label,
          }))}
          onChange={setMetric}
        />
        <TableToggle
          open={showTable}
          onToggle={() => setShowTable((current) => !current)}
        />
      </div>
      <div
        className="flex flex-col gap-1"
        role="group"
        aria-label={`${metricLabel} by organisation`}
      >
        {bars.map((bar) => (
          <OrganisationBar
            key={bar.id}
            label={bar.label}
            value={bar.value}
            organisations={bar.organisations}
            percent={(bar.value / max) * 100}
            metricLabel={metricLabel}
          />
        ))}
      </div>
      <div className="flex justify-between text-caption text-subtle">
        <span>0</span>
        <span>{formatTick(max)}</span>
      </div>
      {showTable ? <OrganisationsTable organisations={organisations} /> : null}
    </div>
  )
}
