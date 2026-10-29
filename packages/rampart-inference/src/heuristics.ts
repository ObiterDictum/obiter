import type { PiiLabel, Span } from "./types";
import { isLuhnValid, isValidSsn } from "./validators";

interface DigitRule {
  readonly label: PiiLabel;
  readonly lengths: readonly number[];
  readonly validate: (digits: string) => boolean;
}

const DIGIT_RULES: readonly DigitRule[] = [
  { label: "CREDIT_CARD", lengths: [16, 15, 14], validate: isLuhnValid },
  { label: "SSN", lengths: [9], validate: isValidSsn },
];

interface DigitRun {
  readonly digits: string;
  readonly rawIndex: number[];
}

const DIGIT_RUN = /\d(?:[ .-]?\d)*/g;

function extractRuns(raw: string): DigitRun[] {
  const runs: DigitRun[] = [];
  DIGIT_RUN.lastIndex = 0;
  for (let m = DIGIT_RUN.exec(raw); m !== null; m = DIGIT_RUN.exec(raw)) {
    const digits: string[] = [];
    const rawIndex: number[] = [];
    for (let i = 0; i < m[0].length; i++) {
      const code = m[0].charCodeAt(i);
      if (code >= 0x30 && code <= 0x39) {
        digits.push(m[0][i]);
        rawIndex.push(m.index + i);
      }
    }
    runs.push({ digits: digits.join(""), rawIndex });
  }
  return runs;
}

function detectDigitEntities(raw: string): Span[] {
  const spans: Span[] = [];
  for (const run of extractRuns(raw)) {
    for (const rule of DIGIT_RULES) {
      if (!rule.lengths.includes(run.digits.length)) continue;
      if (!rule.validate(run.digits)) continue;
      const start = run.rawIndex[0];
      const end = run.rawIndex[run.rawIndex.length - 1] + 1;
      spans.push({ start, end, label: rule.label, score: 1, source: "heuristic", text: raw.slice(start, end) });
      break;
    }
  }
  return spans;
}

const TEXT_RULES: readonly { label: PiiLabel; pattern: RegExp; group?: number }[] = [
  { label: "EMAIL", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { label: "URL", pattern: /\bhttps?:\/\/[^\s<>"'\])}]+/g },
  { label: "URL", pattern: /\bwww\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s<>"'\])}]*)?/g },
  { label: "IP_ADDRESS", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  {
    label: "IP_ADDRESS",
    pattern:
      /(?<![:.\w])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}|::(?:[0-9A-Fa-f]{1,4}:){0,6}[0-9A-Fa-f]{1,4})(?![:.\w])/g,
  },
  { label: "IP_ADDRESS", pattern: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g },
];

function detectTextEntities(raw: string): Span[] {
  const spans: Span[] = [];
  for (const { label, pattern, group } of TEXT_RULES) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(raw); m !== null; m = pattern.exec(raw)) {
      const text = group === undefined ? m[0] : m[group];
      const offset = group === undefined ? 0 : m[0].indexOf(text);
      spans.push({
        start: m.index + offset,
        end: m.index + offset + text.length,
        label,
        score: 1,
        source: "heuristic",
        text,
      });
    }
  }
  return spans;
}

export function detectHeuristics(raw: string): Span[] {
  return [
    ...detectDigitEntities(raw),
    ...detectTextEntities(raw),
  ];
}
