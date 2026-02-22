import { CASE_LIBRARY_SCHEMA_VERSION } from "./caseLibraryStore";
import type { CaseBundle } from "./caseBundle";

export const CASE_PROVENANCE_COPY_SCHEMA = "case-provenance.v1";

export type CaseProvenanceSource =
  | "imported"
  | "generated"
  | "library-import"
  | "library-export"
  | "unknown";

export interface CaseProvenanceInput {
  bundle: CaseBundle;
  caseLabel: string;
  fingerprint: string;
  source: CaseProvenanceSource;
  importedAt?: string | null;
  savedAt?: string | null;
  includeLibraryVersion?: boolean;
}

export interface CaseProvenanceModel {
  caseLabel: string;
  fingerprint: string;
  sourceLabel: string;
  bundleSchemaVersion: string;
  librarySchemaVersion: string | null;
  createdAt: string;
  importedAt: string | null;
  savedAt: string | null;
  runCount: number;
  copyText: string;
}

function normalizeTimestamp(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) {
    return null;
  }
  return new Date(millis).toISOString();
}

function normalizeCaseLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "Unsaved case";
  }
  return trimmed.slice(0, 120);
}

function normalizeSource(source: CaseProvenanceSource): string {
  if (source === "imported") {
    return "Imported bundle";
  }
  if (source === "generated") {
    return "Generated from visible runs";
  }
  if (source === "library-import") {
    return "Case library (import source)";
  }
  if (source === "library-export") {
    return "Case library (generated source)";
  }
  return "Unknown source";
}

function normalizeFingerprint(value: string): string {
  return value.trim().toLowerCase();
}

export function buildCaseProvenanceModel(input: CaseProvenanceInput): CaseProvenanceModel {
  const caseLabel = normalizeCaseLabel(input.caseLabel);
  const fingerprint = normalizeFingerprint(input.fingerprint);
  const createdAt = normalizeTimestamp(input.bundle.createdAt) ?? "1970-01-01T00:00:00.000Z";
  const importedAt = normalizeTimestamp(input.importedAt);
  const savedAt = normalizeTimestamp(input.savedAt);
  const sourceLabel = normalizeSource(input.source);
  const librarySchemaVersion = input.includeLibraryVersion ? String(CASE_LIBRARY_SCHEMA_VERSION) : null;

  const copyLines = [
    `schema=${CASE_PROVENANCE_COPY_SCHEMA}`,
    `caseLabel=${caseLabel}`,
    `source=${sourceLabel}`,
    `fingerprint=${fingerprint}`,
    `bundleSchemaVersion=${input.bundle.schemaVersion}`,
    `librarySchemaVersion=${librarySchemaVersion ?? "n/a"}`,
    `createdAt=${createdAt}`,
    `importedAt=${importedAt ?? "n/a"}`,
    `savedAt=${savedAt ?? "n/a"}`,
    `runCount=${input.bundle.runs.length}`,
  ];

  return {
    caseLabel,
    fingerprint,
    sourceLabel,
    bundleSchemaVersion: input.bundle.schemaVersion,
    librarySchemaVersion,
    createdAt,
    importedAt,
    savedAt,
    runCount: input.bundle.runs.length,
    copyText: copyLines.join("\n"),
  };
}
