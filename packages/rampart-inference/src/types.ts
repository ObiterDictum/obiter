export type PiiLabel =
  | "SSN"
  | "CREDIT_CARD"
  | "IP_ADDRESS"
  | "GIVEN_NAME"
  | "SURNAME"
  | "EMAIL"
  | "PHONE"
  | "URL"
  | "TAX_ID"
  | "BANK_ACCOUNT"
  | "ROUTING_NUMBER"
  | "GOVERNMENT_ID"
  | "PASSPORT"
  | "DRIVERS_LICENSE"
  | "BUILDING_NUMBER"
  | "STREET_NAME"
  | "SECONDARY_ADDRESS"
  | "CITY"
  | "STATE"
  | "ZIP_CODE";

export const KEEP_LABELS: ReadonlySet<PiiLabel> = new Set<PiiLabel>(["CITY", "STATE", "ZIP_CODE"]);

export interface Span {
  readonly start: number;
  readonly end: number;
  readonly label: PiiLabel;
  readonly score: number;
  readonly source: "heuristic" | "ner";
  readonly text: string;
}

function resolveKeepLabels(keepLabels?: readonly PiiLabel[]): ReadonlySet<PiiLabel> {
  return keepLabels === undefined ? KEEP_LABELS : new Set(keepLabels);
}

export function shouldRedact(label: PiiLabel, keepLabels: ReadonlySet<PiiLabel> = KEEP_LABELS): boolean {
  return !keepLabels.has(label);
}
