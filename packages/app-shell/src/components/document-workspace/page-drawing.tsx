import { Image as ImageIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { drawingAnchor, drawingScene } from '../../document-page-drawings'
import {
  drawingBoxSize,
  drawingHasPicture,
  drawingShapeFill,
} from '../../document-page-media'

export function PageDrawing({
  xml,
  imageUrl,
  fallbackLabel,
  ignoreAnchor = false,
}: {
  xml: string
  imageUrl?: string
  fallbackLabel: string
  ignoreAnchor?: boolean
}) {
  const scene = drawingScene(xml)
  const node = drawingNode(xml, scene, imageUrl, fallbackLabel)
  if (!node) return null
  if (ignoreAnchor) return node
  const anchor = drawingAnchor(xml)
  if (!anchor || (anchor.leftPx === 0 && anchor.topPx === 0)) return node
  return (
    <div
      className="relative"
      style={{ marginLeft: anchor.leftPx, marginTop: anchor.topPx }}
    >
      {node}
    </div>
  )
}

function drawingNode(
  xml: string,
  scene: ReturnType<typeof drawingScene>,
  imageUrl: string | undefined,
  fallbackLabel: string,
): ReactNode {
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
