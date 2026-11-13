import { useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@obiter/ui'
import type { StaffUsageOrganisation } from '@obiter/contracts'
import { SegmentedControl } from '../segmented-control'
import {
  ORG_METRICS,
  formatCount,
  orgChart,
  orgFoldText,
  type OrgMetricKey,
} from './staff-chart-data'
import { OrganisationsTable, TableToggle } from './staff-usage-tables'

const BAR_COLOUR = 'var(--obiter-chart-1)'
const VALUE_CHAR_WIDTH = 7
const VALUE_LABEL_PAD = 12
const VALUE_LABEL_GAP = 8

function valueLabelGutter(bars: { value: number }[]): number {
  const widest = Math.max(
    1,
    ...bars.map((bar) => formatCount(bar.value).length),
  )
  return widest * VALUE_CHAR_WIDTH + VALUE_LABEL_PAD
}

function OrganisationBar({
  label,
  value,
  percent,
  metricLabel,
  gutter,
}: {
  label: string
  value: number
  percent: number
  metricLabel: string
  gutter: number
}) {
  const description = `${label}: ${formatCount(value)} ${metricLabel.toLowerCase()}`
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-32 shrink-0 truncate text-meta text-ink @pane:w-44"
        title={label}
      >
        {label}
      </div>
      <div className="relative h-5 min-w-0 flex-1">
        <div className="absolute inset-y-0 left-0" style={{ right: gutter }}>
          {percent > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={description}
                    className="absolute inset-y-0 left-0 block rounded-r-sm transition-[filter] duration-150 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
          <span
            className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-caption text-muted tabular-nums"
            style={{ left: `calc(${percent}% + ${VALUE_LABEL_GAP}px)` }}
          >
            {formatCount(value)}
          </span>
        </div>
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
  const chart = orgChart(organisations, metric)
  const gutter = valueLabelGutter(chart.bars)
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
      <div className="flex flex-col gap-3">
        <div
          className="flex flex-col gap-0.5"
          role="group"
          aria-label={`${metricLabel} by organisation`}
        >
          {chart.bars.map((bar) => (
            <OrganisationBar
              key={bar.id}
              label={bar.label}
              value={bar.value}
              percent={(bar.value / chart.max) * 100}
              metricLabel={metricLabel}
              gutter={gutter}
            />
          ))}
        </div>
        {chart.fold ? (
          <p className="text-caption text-muted">
            {orgFoldText(chart.fold, metricLabel)}
          </p>
        ) : null}
      </div>
      {showTable ? <OrganisationsTable organisations={organisations} /> : null}
    </div>
  )
}
