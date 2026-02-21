import { redactOutput } from "./redaction";

export type FingerprintSeverity = "INFO" | "WARN" | "ERROR";

export interface EventFingerprintInput {
  severity: FingerprintSeverity;
  label: string;
  message: string;
  reasonCode?: string | null;
}

function normalizeFragment(input: string): string {
  const firstLine = redactOutput(input).split(/\r?\n/, 1)[0] ?? "";
  return firstLine.trim().toLowerCase().replace(/\s+/g, " ");
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildEventFingerprint(input: EventFingerprintInput): string {
  const canonical = [
    "v1",
    input.severity,
    normalizeFragment(input.label),
    normalizeFragment(input.message),
    normalizeFragment(input.reasonCode ?? ""),
  ].join("|");
  return `fp-${fnv1a32(canonical)}`;
}
