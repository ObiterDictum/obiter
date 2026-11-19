import { createContext, type ReactNode } from 'react'

export type PaintDocumentRun = (
  paragraphId: string,
  runId: string,
  text: string,
  from: number,
  render?: (text: string, offset: number) => ReactNode,
) => ReactNode

export const DocumentRunPaintContext = createContext<PaintDocumentRun | null>(
  null,
)
