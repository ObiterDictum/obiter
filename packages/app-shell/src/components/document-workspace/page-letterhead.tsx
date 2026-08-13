import type { CSSProperties, ReactNode } from 'react'
import type {
  DocumentParagraphWire,
  DocumentRelationshipWire,
} from '@obiter/contracts'
import type {
  HeaderLetterhead,
  FooterLetterhead,
  TabStop,
} from '../../document-page-margin'
import { imagePartNameForDrawing } from '../../document-page-media'
import { PageDrawing } from './page-drawing'

export function LetterheadBar({
  letterhead,
  imageLabel,
  storyPartName,
  relationships,
  imageUrls,
}: {
  letterhead: HeaderLetterhead
  imageLabel: string
  storyPartName: string
  relationships: DocumentRelationshipWire[]
  imageUrls: Record<string, string>
}) {
  return (
    <div
      className="flex w-full items-stretch"
      style={{ minHeight: letterhead.heightPx }}
    >
      <div
        className="min-w-0 flex-1"
        style={{ backgroundColor: letterhead.leftFill }}
      />
      <div className="flex shrink-0 items-center justify-center px-3">
        {letterhead.pictures.map((xml, index) => {
          const partName = imagePartNameForDrawing(
            xml,
            storyPartName,
            relationships,
          )
          return (
            <PageDrawing
              key={`letterhead-${index}`}
              xml={xml}
              imageUrl={partName ? imageUrls[partName] : undefined}
              fallbackLabel={imageLabel}
            />
          )
        })}
      </div>
      <div
        className="min-w-0 flex-1"
        style={{ backgroundColor: letterhead.rightFill }}
      />
    </div>
  )
}

export function FooterBand({
  letterhead,
  inset,
}: {
  letterhead: FooterLetterhead
  inset: { left: number; right: number }
}) {
  return (
    <div
      className="flex w-full items-center text-[10px] leading-[1.25] text-white"
      style={{
        backgroundColor: letterhead.fill,
        minHeight: letterhead.heightPx,
        paddingLeft: inset.left,
        paddingRight: inset.right,
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      <div className="min-w-0 flex-1">
        {letterhead.rows.map((row, index) =>
          row.left ? <div key={`left-${index}`}>{row.left}</div> : null,
        )}
      </div>
      <div className="shrink-0 px-3 text-center text-[12px]">
        {letterhead.page}
      </div>
      <div className="min-w-0 flex-1 text-right">
        {letterhead.rows.map((row, index) =>
          row.right ? <div key={`right-${index}`}>{row.right}</div> : null,
        )}
      </div>
    </div>
  )
}

export function TabLine({
  columns,
  stops,
  render,
}: {
  columns: DocumentParagraphWire['runs'][]
  stops: TabStop[]
  render: (runs: DocumentParagraphWire['runs']) => ReactNode
}) {
  if (stops.length === 0) {
    return (
      <div className="flex w-full justify-between gap-4">
        {columns.map((column, index) => (
          <div
            key={`col-${index}`}
            className={
              index === 0
                ? 'text-left'
                : index === columns.length - 1
                  ? 'text-right'
                  : 'text-center'
            }
          >
            {render(column)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="relative w-full" style={{ minHeight: '1.15em' }}>
      {columns.map((column, index) => {
        const stop =
          index === 0 ? { val: 'left' as const, posPx: 0 } : stops[index - 1]
        if (!stop) return null
        const style: CSSProperties =
          stop.val === 'right'
            ? {
                left: stop.posPx,
                transform: 'translateX(-100%)',
                textAlign: 'right',
              }
            : stop.val === 'center'
              ? {
                  left: stop.posPx,
                  transform: 'translateX(-50%)',
                  textAlign: 'center',
                }
              : { left: stop.posPx }
        return (
          <div
            key={`col-${index}`}
            className="absolute top-0 whitespace-nowrap"
            style={style}
          >
            {render(column)}
          </div>
        )
      })}
    </div>
  )
}
