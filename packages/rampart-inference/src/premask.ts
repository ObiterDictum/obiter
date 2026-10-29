import { mergeSpans } from "./policy";
import type { PiiLabel, Span } from "./types";

export interface PremaskResult {
  readonly masked: string;
  readonly rawStart: number[];
  readonly rawEnd: number[];
}

function sentinelFor(label: PiiLabel): string {
  return `[${label}]`;
}

export function premask(raw: string, spans: readonly Span[]): PremaskResult {
  const ordered = mergeSpans(spans).slice().sort((a, b) => a.start - b.start);
  let masked = "";
  const rawStart: number[] = [];
  const rawEnd: number[] = [];

  const copyVerbatim = (from: number, to: number): void => {
    for (let i = from; i < to; i++) {
      masked += raw[i];
      rawStart.push(i);
      rawEnd.push(i + 1);
    }
  };

  let cursor = 0;
  for (const span of ordered) {
    if (span.start < cursor) continue;
    copyVerbatim(cursor, span.start);
    const sentinel = sentinelFor(span.label);
    for (const ch of sentinel) {
      masked += ch;
      rawStart.push(span.start);
      rawEnd.push(span.end);
    }
    cursor = span.end;
  }
  copyVerbatim(cursor, raw.length);

  return { masked, rawStart, rawEnd };
}

export function projectMaskedSpan(span: Span, raw: string, map: PremaskResult): Span | null {
  if (span.end <= span.start) return null;
  const start = map.rawStart[span.start];
  const end = map.rawEnd[span.end - 1];
  if (start === undefined || end === undefined || end <= start) return null;
  return { ...span, start, end, text: raw.slice(start, end) };
}
