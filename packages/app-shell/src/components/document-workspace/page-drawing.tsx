import {
  drawingBoxSize,
  drawingHasPicture,
  drawingShapeFill,
} from '../../document-page-media'
import { drawingScene } from '../../document-page-drawings'
import { Image as ImageIcon } from '@phosphor-icons/react'

export function PageDrawing({
  xml,
  imageUrl,
  fallbackLabel,
}: {
  xml: string
  imageUrl?: string
  fallbackLabel: string
}) {
  const scene = drawingScene(xml)
  if (scene.parts.length > 1) {
    return (
      <div
        className="relative max-w-full overflow-hidden"
        style={{ width: scene.widthPx, height: scene.heightPx }}
      >
        {scene.parts.map((part, index) =>
          part.kind === 'picture' ? (
            imageUrl ? (
              <img
                key={index}
                src={imageUrl}
                alt=""
                className="absolute object-contain"
                style={{
                  left: part.leftPx,
                  top: part.topPx,
                  width: part.widthPx,
                  height: part.heightPx,
                }}
              />
            ) : (
              <div
                key={index}
                role="img"
                aria-label={fallbackLabel}
                className="absolute flex items-center justify-center bg-[#f4f2ee] text-[11px] text-[#6b6862]"
                style={{
                  left: part.leftPx,
                  top: part.topPx,
                  width: part.widthPx,
                  height: part.heightPx,
                }}
              >
                <ImageIcon size={16} />
              </div>
            )
          ) : (
            <div
              key={index}
              aria-hidden="true"
              className="absolute"
              style={{
                left: part.leftPx,
                top: part.topPx,
                width: part.widthPx,
                height: part.heightPx,
                backgroundColor: part.fill,
              }}
            />
          ),
        )}
      </div>
    )
  }

  const part = scene.parts[0]
  const size = part
    ? { width: part.widthPx, height: part.heightPx }
    : drawingBoxSize(xml)
  if (imageUrl && (part?.kind === 'picture' || drawingHasPicture(xml))) {
    return (
      <img
        src={imageUrl}
        alt=""
        className="inline-block object-contain"
        style={{ width: size.width, height: size.height }}
      />
    )
  }

  const fill = part?.fill ?? drawingShapeFill(xml)
  if (fill) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: size.width,
          height: size.height,
          backgroundColor: fill,
        }}
      />
    )
  }

  if (!drawingHasPicture(xml)) return null

  return (
    <div
      role="img"
      aria-label={fallbackLabel}
      className="inline-flex items-center justify-center gap-2 border border-[#c5c1b8] bg-[#f4f2ee] text-[11px] text-[#6b6862]"
      style={{ width: size.width, height: size.height }}
    >
      <ImageIcon size={16} />
      {size.width >= 120 ? <span>{fallbackLabel}</span> : null}
    </div>
  )
}
