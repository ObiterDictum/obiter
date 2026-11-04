import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import {
  SplitScaleProvider,
  splitPageZoom,
  splitPaneFit,
  useSplitScale,
  type SplitPaneMetrics,
} from './matter-split-scale'

const letter = 816

const wide: SplitPaneMetrics = {
  paneWidth: 700,
  scrollbarWidth: 15,
  paperWidth: letter,
}
const narrow: SplitPaneMetrics = {
  paneWidth: 420,
  scrollbarWidth: 15,
  paperWidth: letter,
}

afterEach(cleanup)

describe('splitPaneFit', () => {
  it('fits the paper to the desk content width, discounting padding and scrollbar', () => {
    expect(splitPaneFit(wide)).toBeCloseTo(621 / letter)
    expect(splitPaneFit({ ...wide, scrollbarWidth: 0 })).toBeCloseTo(
      636 / letter,
    )
  })

  it('never claims space for a paper wider than the content width', () => {
    expect(
      splitPaneFit({ paneWidth: 1200, scrollbarWidth: 0, paperWidth: letter }),
    ).toBe(1)
    expect(
      splitPaneFit({ paneWidth: 120, scrollbarWidth: 0, paperWidth: letter }),
    ).toBeCloseTo(56 / letter)
  })
})

describe('splitPageZoom', () => {
  it('scales both panes to the narrower content width', () => {
    const even = splitPageZoom([wide, narrow], 100)
    expect(even).toBe(41)
    expect(splitPageZoom([narrow, wide], 100)).toBe(even)
  })

  it('stops at actual size and shrinks to whatever is left', () => {
    expect(splitPageZoom([{ ...wide, paneWidth: 2400 }], 100)).toBe(100)
    expect(splitPageZoom([{ ...wide, paneWidth: 200 }], 100)).toBe(14)
  })

  it('applies the shared zoom control to the fitted scale', () => {
    expect(splitPageZoom([narrow], 120)).toBe(50)
    expect(splitPageZoom([narrow], 90)).toBe(37)
  })

  it('leaves the zoom alone before a pane has been measured', () => {
    expect(splitPageZoom([], 100)).toBe(100)
  })
})

function ReportPane({
  id,
  metrics,
}: {
  id: string
  metrics: SplitPaneMetrics
}) {
  const reportPane = useSplitScale()?.reportPane
  useEffect(() => {
    reportPane?.(id, metrics)
  }, [reportPane, id, metrics])
  return null
}

function ReportRibbon({ height }: { height: number }) {
  const reportRibbon = useSplitScale()?.reportRibbon
  useEffect(() => {
    reportRibbon?.(height)
  }, [reportRibbon, height])
  return null
}

function ScaleProbe() {
  const scale = useSplitScale()
  return (
    <span data-testid="scale">
      {scale
        ? `${String(scale.pageZoom)}/${String(scale.ribbonHeight)}`
        : 'off'}
    </span>
  )
}

describe('SplitScaleProvider', () => {
  it('shares one scale and one ribbon height with both sides', async () => {
    render(
      <SplitScaleProvider active zoom={100} onZoom={() => undefined}>
        <ReportPane id="edit" metrics={wide} />
        <ReportPane id="side" metrics={narrow} />
        <ReportRibbon height={74} />
        <ScaleProbe />
      </SplitScaleProvider>,
    )
    expect((await screen.findByTestId('scale')).textContent).toBe('41/74')
  })

  it('leaves the workspace alone while no side is open', () => {
    render(
      <SplitScaleProvider active={false} zoom={100} onZoom={() => undefined}>
        <ReportPane id="edit" metrics={narrow} />
        <ScaleProbe />
      </SplitScaleProvider>,
    )
    expect(screen.getByTestId('scale').textContent).toBe('off')
  })
})
