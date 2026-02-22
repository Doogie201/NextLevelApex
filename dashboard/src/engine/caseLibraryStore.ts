import { buildCaseBundleJson, parseCaseBundleJson, type CaseBundle } from "./caseBundle";

export const CASE_LIBRARY_STORAGE_KEY = "nlx.gui.caseLibrary.v1";
export const CASE_LIBRARY_SCHEMA_VERSION = 1;
export const CASE_LIBRARY_MAX_ENTRIES = 20;
export const CASE_LIBRARY_NOTE_MAX_CHARS = 4_000;

export type CaseLibrarySource = "import" | "export";
export type CaseLibraryLoadStatus = "ok" | "migrated" | "cleared_corrupt" | "ignored_newer_schema";

export interface CaseLibraryStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface CaseLibraryEntry {
  id: string;
  name: string;
  source: CaseLibrarySource;
  savedAt: string;
  fingerprint: string;
  bundle: CaseBundle;
  notes: string;
  notesUpdatedAt: string | null;
}

interface CaseLibraryEnvelope {
  schemaVersion: number;
  entries: CaseLibraryEntry[];
}

interface CaseLibraryEnvelopeV0 {
  schemaVersion: 0;
  entries: Array<{
    id?: unknown;
    name?: unknown;
    source?: unknown;
    savedAt?: unknown;
    fingerprint?: unknown;
    bundle?: unknown;
  }>;
}

export interface CaseLibraryLoadState {
  entries: CaseLibraryEntry[];
  status: CaseLibraryLoadStatus;
}

export interface SaveCaseLibraryInput {
  bundle: CaseBundle;
  source: CaseLibrarySource;
  name?: string;
  savedAt?: string;
}

export interface SaveCaseLibrarySuccess {
  ok: true;
  entries: CaseLibraryEntry[];
  entry: CaseLibraryEntry;
  updatedExisting: boolean;
}

export interface SaveCaseLibraryFailure {
  ok: false;
  entries: CaseLibraryEntry[];
  error: string;
}

export type SaveCaseLibraryResult = SaveCaseLibrarySuccess | SaveCaseLibraryFailure;

export interface OpenCaseLibraryResult {
  entry: CaseLibraryEntry | null;
  warning: string | null;
}

export interface CaseLibraryFilter {
  query: string;
}

export interface CaseLibraryIntegritySummary {
  caseId: string;
  storedFingerprint: string;
  recomputedFingerprint: string;
  shortFingerprint: string;
  mismatch: boolean;
  runCount: number;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTimestamp(iso: string): string {
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) {
    return "1970-01-01T00:00:00.000Z";
  }
  return new Date(millis).toISOString();
}

function normalizeNotes(value: string): string {
  return value.replace(/\u0000/g, "").slice(0, CASE_LIBRARY_NOTE_MAX_CHARS);
}

function compareByNewest(left: CaseLibraryEntry, right: CaseLibraryEntry): number {
  const leftMs = Date.parse(left.savedAt);
  const rightMs = Date.parse(right.savedAt);
  if (leftMs !== rightMs) {
    return rightMs - leftMs;
  }
  return left.id.localeCompare(right.id);
}

function sortEntries(entries: CaseLibraryEntry[]): CaseLibraryEntry[] {
  return [...entries].sort(compareByNewest);
}

function deriveCaseName(bundle: CaseBundle): string {
  const created = normalizeTimestamp(bundle.createdAt).replace("T", " ").slice(0, 16);
  const firstCommand = bundle.runs[0]?.commandId ?? "bundle";
  return `${firstCommand} case ${created}`;
}

function normalizeCaseName(value: string | undefined, bundle: CaseBundle): string {
  const candidate = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!candidate) {
    return deriveCaseName(bundle);
  }
  return candidate.slice(0, 96);
}

function normalizeFingerprint(fingerprint: string): string {
  return fingerprint.trim().toLowerCase();
}

export function toShortFingerprint(fingerprint: string): string {
  const normalized = normalizeFingerprint(fingerprint);
  if (normalized.length <= 20) {
    return normalized;
  }
  return `${normalized.slice(0, 16)}…`;
}

function normalizeSource(value: unknown): CaseLibrarySource {
  return value === "import" ? "import" : "export";
}

function validateCaseBundle(value: unknown): CaseBundle | null {
  if (!isObjectRecord(value)) {
    return null;
  }
  const raw = JSON.stringify(value);
  const parsed = parseCaseBundleJson(raw);
  if (!parsed.ok) {
    return null;
  }
  return parsed.bundle;
}

function toUint32(value: number): number {
  return value >>> 0;
}

function hashFnv1a32(payload: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = toUint32(hash * 0x01000193);
  }
  return hash.toString(16).padStart(8, "0");
}

export function buildCaseBundleFingerprint(bundle: CaseBundle): string {
  const canonical = buildCaseBundleJson(bundle);
  return `fingerprint-fnv1a32-${hashFnv1a32(canonical)}`;
}

function createCaseEntryId(fingerprint: string): string {
  return `case-${normalizeFingerprint(fingerprint)}`;
}

function normalizeEntry(entry: CaseLibraryEntry): CaseLibraryEntry | null {
  const bundle = validateCaseBundle(entry.bundle);
  if (!bundle) {
    return null;
  }
  const fingerprint = normalizeFingerprint(entry.fingerprint || buildCaseBundleFingerprint(bundle));
  const id = entry.id?.trim() ? entry.id.trim() : createCaseEntryId(fingerprint);
  return {
    id,
    name: normalizeCaseName(entry.name, bundle),
    source: normalizeSource(entry.source),
    savedAt: normalizeTimestamp(entry.savedAt),
    fingerprint,
    bundle,
    notes: normalizeNotes(entry.notes ?? ""),
    notesUpdatedAt: entry.notesUpdatedAt ? normalizeTimestamp(entry.notesUpdatedAt) : null,
  };
}

function normalizeEntries(entries: CaseLibraryEntry[]): CaseLibraryEntry[] {
  const deduped = new Map<string, CaseLibraryEntry>();
  for (const entry of entries) {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      continue;
    }
    deduped.set(normalized.id, normalized);
  }
  return sortEntries([...deduped.values()]);
}

function migrateV0Envelope(parsed: CaseLibraryEnvelopeV0): CaseLibraryEntry[] {
  const migrated: CaseLibraryEntry[] = [];
  for (const raw of parsed.entries) {
    if (!isObjectRecord(raw)) {
      continue;
    }
    const bundle = validateCaseBundle(raw.bundle);
    if (!bundle) {
      continue;
    }
    const fingerprint = normalizeFingerprint(
      typeof raw.fingerprint === "string" ? raw.fingerprint : buildCaseBundleFingerprint(bundle),
    );
    const id = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : createCaseEntryId(fingerprint);
    migrated.push({
      id,
      name: normalizeCaseName(typeof raw.name === "string" ? raw.name : undefined, bundle),
      source: normalizeSource(raw.source),
      savedAt: normalizeTimestamp(typeof raw.savedAt === "string" ? raw.savedAt : bundle.createdAt),
      fingerprint,
      bundle,
      notes: "",
      notesUpdatedAt: null,
    });
  }
  return normalizeEntries(migrated);
}

function clearStorage(storage: CaseLibraryStorageLike): void {
  if (typeof storage.removeItem === "function") {
    storage.removeItem(CASE_LIBRARY_STORAGE_KEY);
    return;
  }
  storage.setItem(CASE_LIBRARY_STORAGE_KEY, "");
}

function migrateEnvelope(parsed: unknown): CaseLibraryLoadState {
  if (!isObjectRecord(parsed) || typeof parsed.schemaVersion !== "number" || !Array.isArray(parsed.entries)) {
    return {
      entries: [],
      status: "cleared_corrupt",
    };
  }

  if (parsed.schemaVersion > CASE_LIBRARY_SCHEMA_VERSION) {
    return {
      entries: [],
      status: "ignored_newer_schema",
    };
  }

  if (parsed.schemaVersion === 0) {
    return {
      entries: migrateV0Envelope(parsed as unknown as CaseLibraryEnvelopeV0),
      status: "migrated",
    };
  }

  if (parsed.schemaVersion < CASE_LIBRARY_SCHEMA_VERSION) {
    return {
      entries: [],
      status: "migrated",
    };
  }

  const entries = (parsed.entries as unknown[])
    .filter((entry): entry is CaseLibraryEntry => isObjectRecord(entry))
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is CaseLibraryEntry => entry !== null);

  return {
    entries: normalizeEntries(entries),
    status: "ok",
  };
}

export function loadCaseLibraryState(storage: CaseLibraryStorageLike): CaseLibraryLoadState {
  const raw = storage.getItem(CASE_LIBRARY_STORAGE_KEY);
  if (!raw) {
    return {
      entries: [],
      status: "ok",
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const migrated = migrateEnvelope(parsed);
    if (migrated.status === "cleared_corrupt") {
      clearStorage(storage);
      return migrated;
    }
    if (migrated.status === "migrated") {
      storeCaseLibrary(storage, migrated.entries);
    }
    return migrated;
  } catch {
    clearStorage(storage);
    return {
      entries: [],
      status: "cleared_corrupt",
    };
  }
}

export function storeCaseLibrary(storage: CaseLibraryStorageLike, entries: CaseLibraryEntry[]): void {
  const envelope: CaseLibraryEnvelope = {
    schemaVersion: CASE_LIBRARY_SCHEMA_VERSION,
    entries: normalizeEntries(entries),
  };
  storage.setItem(CASE_LIBRARY_STORAGE_KEY, JSON.stringify(envelope));
}

export function clearCaseLibraryStorage(storage: CaseLibraryStorageLike): void {
  clearStorage(storage);
}

function buildValidatedBundle(bundle: CaseBundle): CaseBundle | null {
  const parsed = parseCaseBundleJson(buildCaseBundleJson(bundle));
  if (!parsed.ok) {
    return null;
  }
  return parsed.bundle;
}

export function saveCaseLibraryEntry(existing: CaseLibraryEntry[], input: SaveCaseLibraryInput): SaveCaseLibraryResult {
  const validated = buildValidatedBundle(input.bundle);
  if (!validated) {
    return {
      ok: false,
      entries: normalizeEntries(existing),
      error: "Cannot save case: bundle validation failed.",
    };
  }

  const normalizedExisting = normalizeEntries(existing);
  const fingerprint = buildCaseBundleFingerprint(validated);
  const existingByFingerprint = normalizedExisting.find((entry) => entry.fingerprint === fingerprint) ?? null;
  const savedAt = normalizeTimestamp(input.savedAt ?? new Date().toISOString());
  const nextEntry: CaseLibraryEntry = {
    id: existingByFingerprint?.id ?? createCaseEntryId(fingerprint),
    name: normalizeCaseName(input.name, validated),
    source: input.source,
    savedAt,
    fingerprint,
    bundle: validated,
    notes: existingByFingerprint?.notes ?? "",
    notesUpdatedAt: existingByFingerprint?.notesUpdatedAt ?? null,
  };

  if (!existingByFingerprint && normalizedExisting.length >= CASE_LIBRARY_MAX_ENTRIES) {
    return {
      ok: false,
      entries: normalizedExisting,
      error: `Case library is full (${CASE_LIBRARY_MAX_ENTRIES} cases). Delete a case before saving another.`,
    };
  }

  const nextEntries = normalizeEntries([nextEntry, ...normalizedExisting.filter((entry) => entry.id !== nextEntry.id)]);
  return {
    ok: true,
    entries: nextEntries,
    entry: nextEntry,
    updatedExisting: Boolean(existingByFingerprint),
  };
}

export function deleteCaseLibraryEntry(entries: CaseLibraryEntry[], caseId: string): CaseLibraryEntry[] {
  return normalizeEntries(entries.filter((entry) => entry.id !== caseId));
}

export function updateCaseLibraryNotes(
  entries: CaseLibraryEntry[],
  caseId: string,
  notes: string,
  updatedAt?: string,
): CaseLibraryEntry[] {
  const normalizedUpdatedAt = normalizeTimestamp(updatedAt ?? new Date().toISOString());
  const normalizedNotes = normalizeNotes(notes);
  return normalizeEntries(
    entries.map((entry) => {
      if (entry.id !== caseId) {
        return entry;
      }
      return {
        ...entry,
        notes: normalizedNotes,
        notesUpdatedAt: normalizedNotes.length > 0 ? normalizedUpdatedAt : null,
      };
    }),
  );
}

export function filterCaseLibraryEntries(entries: CaseLibraryEntry[], filter: CaseLibraryFilter): CaseLibraryEntry[] {
  const query = filter.query.trim().toLowerCase().replace(/\s+/g, " ");
  const sorted = sortEntries(entries);
  if (!query) {
    return sorted;
  }
  return sorted.filter((entry) => {
    const corpus = [
      entry.name,
      entry.id,
      entry.fingerprint,
      entry.savedAt,
      entry.bundle.createdAt,
      entry.bundle.runs[0]?.commandId ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return corpus.includes(query);
  });
}

export function openCaseLibraryEntry(entries: CaseLibraryEntry[], caseId: string): OpenCaseLibraryResult {
  const found = normalizeEntries(entries).find((entry) => entry.id === caseId) ?? null;
  if (!found) {
    return {
      entry: null,
      warning: "Case not found in local library.",
    };
  }
  const recomputedFingerprint = buildCaseBundleFingerprint(found.bundle);
  if (recomputedFingerprint !== found.fingerprint) {
    return {
      entry: found,
      warning: "Case fingerprint mismatch detected. Local storage may have been modified.",
    };
  }
  return {
    entry: found,
    warning: null,
  };
}

export function buildCaseBundleExportJson(entry: Pick<CaseLibraryEntry, "bundle">): string {
  return buildCaseBundleJson(entry.bundle);
}

export function summarizeCaseLibraryIntegrity(entries: CaseLibraryEntry[]): CaseLibraryIntegritySummary[] {
  return normalizeEntries(entries).map((entry) => {
    const recomputed = normalizeFingerprint(buildCaseBundleFingerprint(entry.bundle));
    const stored = normalizeFingerprint(entry.fingerprint);
    return {
      caseId: entry.id,
      storedFingerprint: stored,
      recomputedFingerprint: recomputed,
      shortFingerprint: toShortFingerprint(stored),
      mismatch: stored !== recomputed,
      runCount: entry.bundle.runs.length,
    };
  });
}
