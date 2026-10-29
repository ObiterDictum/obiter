import { KEEP_LABELS, shouldRedact, type PiiLabel, type Span } from "./types";

export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const prev = merged[merged.length - 1];
    if (prev === undefined || span.start >= prev.end) {
      merged.push(span);
      continue;
    }
    const winner = preferred(prev, span);
    const prevContains = prev.start <= span.start && prev.end >= span.end;
    const spanContains = span.start <= prev.start && span.end >= prev.end;
    if (prevContains || spanContains) {
      merged[merged.length - 1] = winner;
    } else {
      const start = Math.min(prev.start, span.start);
      const end = Math.max(prev.end, span.end);
      merged[merged.length - 1] = { ...winner, start, end, text: winner.text };
    }
  }
  return merged;
}

function preferred(a: Span, b: Span): Span {
  if (a.score !== b.score) return a.score > b.score ? a : b;
  const aLen = a.end - a.start;
  const bLen = b.end - b.start;
  if (aLen !== bLen) return aLen > bLen ? a : b;
  return a.source === "heuristic" ? a : b;
}

function applyPolicy(spans: readonly Span[], keepLabels: ReadonlySet<PiiLabel> = KEEP_LABELS): Span[] {
  return mergeSpans(spans)
    .filter((s) => shouldRedact(s.label, keepLabels))
    .sort((a, b) => b.start - a.start);
}
