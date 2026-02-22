import {
  CASE_LIBRARY_MAX_ENTRIES,
  CASE_LIBRARY_SCHEMA_VERSION,
  CASE_LIBRARY_STORAGE_KEY,
  buildCaseBundleExportJson,
  buildCaseBundleFingerprint,
  clearCaseLibraryStorage,
  filterCaseLibraryEntries,
  loadCaseLibraryState,
  openCaseLibraryEntry,
  saveCaseLibraryEntry,
  storeCaseLibrary,
  summarizeCaseLibraryIntegrity,
  toShortFingerprint,
  updateCaseLibraryNotes,
  type CaseLibraryStorageLike,
} from "../caseLibraryStore";
import { buildCaseBundle, type CaseBundle } from "../caseBundle";
import type { ShareSafeRunExport } from "../runShareSafeExport";

function createStorage(initial: string | null = null): CaseLibraryStorageLike {
  const data = new Map<string, string>();
  if (initial !== null) {
    data.set(CASE_LIBRARY_STORAGE_KEY, initial);
  }
  return {
    getItem(key: string): string | null {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
    removeItem(key: string): void {
      data.delete(key);
    },
  };
}

function buildRun(runId: string, timestamp: string, status: "success" | "error" = "success"): ShareSafeRunExport {
  return {
    schemaVersion: "v1",
    runId,
    bundleId: `bundle-${runId}`,
    bundleKind: "sessions",
    source: "session",
    commandId: status === "success" ? "diagnose" : "dryRunTask",
    status,
    reasonCode: status === "success" ? "SUCCESS" : "EXEC_ERROR",
    timestamp,
    input: {
      text: `mode=ad-hoc\ncommandId=${status === "success" ? "diagnose" : "dryRunTask"}`,
    },
    output: {
      text: status === "success" ? "note: ok" : "note: failed",
    },
    error: status === "success" ? null : { text: "task failed" },
    redacted: true,
  };
}

function buildBundle(runId: string, timestamp: string, status: "success" | "error" = "success"): CaseBundle {
  return buildCaseBundle({
    createdAt: timestamp,
    guiBuildId: "phase25-test",
    runs: [buildRun(runId, timestamp, status)],
  });
}

describe("caseLibraryStore", () => {
  it("persists only expected share-safe fields in a versioned envelope", () => {
    const bundle = buildBundle("run-001", "2026-02-22T02:00:00.000Z");
    const saveResult = saveCaseLibraryEntry([], {
      bundle,
      source: "import",
      name: "Imported case",
      savedAt: "2026-02-22T02:01:00.000Z",
    });
    if (!saveResult.ok) {
      throw new Error("Expected save success");
    }

    const storage = createStorage();
    storeCaseLibrary(storage, saveResult.entries);
    const raw = storage.getItem(CASE_LIBRARY_STORAGE_KEY);
    if (!raw) {
      throw new Error("Expected case library payload");
    }

    const parsed = JSON.parse(raw) as {
      schemaVersion: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(parsed.schemaVersion).toBe(CASE_LIBRARY_SCHEMA_VERSION);
    expect(parsed.entries).toHaveLength(1);
    expect(Object.keys(parsed.entries[0] ?? {}).sort()).toEqual([
      "bundle",
      "fingerprint",
      "id",
      "name",
      "notes",
      "notesUpdatedAt",
      "savedAt",
      "source",
    ]);
    expect((parsed.entries[0] ?? {}).bundle).toBeDefined();
    expect((parsed.entries[0] ?? {}).notes).toBe("");
  });

  it("stores notes locally and excludes notes from default case bundle export", () => {
    const bundle = buildBundle("run-002", "2026-02-22T02:10:00.000Z");
    const saved = saveCaseLibraryEntry([], {
      bundle,
      source: "export",
      name: "Case for notes",
      savedAt: "2026-02-22T02:11:00.000Z",
    });
    if (!saved.ok) {
      throw new Error("Expected save success");
    }

    const withNotes = updateCaseLibraryNotes(
      saved.entries,
      saved.entry.id,
      "Sensitive operator note: DB host looked slow",
      "2026-02-22T02:12:00.000Z",
    );
    expect(withNotes[0]?.notes).toContain("Sensitive operator note");
    expect(withNotes[0]?.notesUpdatedAt).toBe("2026-02-22T02:12:00.000Z");

    const exported = buildCaseBundleExportJson({ bundle: withNotes[0]!.bundle });
    expect(exported).not.toContain("Sensitive operator note");
  });

  it("enforces deterministic quota guardrail by failing once at max entries", () => {
    let entries: ReturnType<typeof filterCaseLibraryEntries> = [];
    for (let index = 0; index < CASE_LIBRARY_MAX_ENTRIES; index += 1) {
      const runId = `run-${String(index + 1).padStart(3, "0")}`;
      const bundle = buildBundle(runId, `2026-02-22T02:${String(index).padStart(2, "0")}:00.000Z`);
      const result = saveCaseLibraryEntry(entries, {
        bundle,
        source: "export",
        savedAt: `2026-02-22T03:${String(index).padStart(2, "0")}:00.000Z`,
      });
      if (!result.ok) {
        throw new Error("Expected save success before quota");
      }
      entries = result.entries;
    }

    const overflow = saveCaseLibraryEntry(entries, {
      bundle: buildBundle("run-overflow", "2026-02-22T04:30:00.000Z"),
      source: "export",
      savedAt: "2026-02-22T04:31:00.000Z",
    });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.error).toContain("Case library is full");
      expect(overflow.entries).toHaveLength(CASE_LIBRARY_MAX_ENTRIES);
    }
  });

  it("produces deterministic fingerprints and warns when stored fingerprint mismatches", () => {
    const bundle = buildBundle("run-003", "2026-02-22T02:20:00.000Z", "error");
    const firstFingerprint = buildCaseBundleFingerprint(bundle);
    const secondFingerprint = buildCaseBundleFingerprint(bundle);
    expect(firstFingerprint).toBe(secondFingerprint);

    const saved = saveCaseLibraryEntry([], {
      bundle,
      source: "import",
      savedAt: "2026-02-22T02:21:00.000Z",
    });
    if (!saved.ok) {
      throw new Error("Expected save success");
    }

    const opened = openCaseLibraryEntry(saved.entries, saved.entry.id);
    expect(opened.entry?.id).toBe(saved.entry.id);
    expect(opened.warning).toBeNull();

    const tampered = saved.entries.map((entry) =>
      entry.id === saved.entry.id ? { ...entry, fingerprint: "fingerprint-fnv1a32-deadbeef" } : entry,
    );
    const reopened = openCaseLibraryEntry(tampered, saved.entry.id);
    expect(reopened.entry?.id).toBe(saved.entry.id);
    expect(reopened.warning).toContain("fingerprint mismatch");

    const summaries = summarizeCaseLibraryIntegrity(tampered);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.mismatch).toBe(true);
    expect(summaries[0]?.shortFingerprint).toBe(toShortFingerprint("fingerprint-fnv1a32-deadbeef"));
  });

  it("migrates legacy schema v0 entries forward safely", () => {
    const legacyBundle = buildBundle("run-legacy", "2026-02-22T01:40:00.000Z");
    const legacy = JSON.stringify({
      schemaVersion: 0,
      entries: [
        {
          name: "Legacy Case",
          source: "import",
          savedAt: "2026-02-22T01:41:00.000Z",
          bundle: legacyBundle,
        },
      ],
    });
    const storage = createStorage(legacy);

    const loaded = loadCaseLibraryState(storage);
    expect(loaded.status).toBe("migrated");
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0]?.name).toBe("Legacy Case");
    expect(loaded.entries[0]?.notes).toBe("");
    expect(loaded.entries[0]?.fingerprint).toMatch(/^fingerprint-fnv1a32-/);

    const persisted = storage.getItem(CASE_LIBRARY_STORAGE_KEY);
    expect(persisted).toContain(`"schemaVersion":${CASE_LIBRARY_SCHEMA_VERSION}`);
  });

  it("clears corrupted payloads without throwing", () => {
    const storage = createStorage("{not-json");
    const loaded = loadCaseLibraryState(storage);
    expect(loaded.status).toBe("cleared_corrupt");
    expect(loaded.entries).toEqual([]);
    expect(storage.getItem(CASE_LIBRARY_STORAGE_KEY)).toBeNull();
  });

  it("supports deterministic filtering by case library search query", () => {
    const alpha = saveCaseLibraryEntry([], {
      bundle: buildBundle("run-alpha", "2026-02-22T01:00:00.000Z"),
      source: "export",
      name: "Alpha Incident",
      savedAt: "2026-02-22T01:10:00.000Z",
    });
    if (!alpha.ok) {
      throw new Error("Expected save success");
    }
    const beta = saveCaseLibraryEntry(alpha.entries, {
      bundle: buildBundle("run-beta", "2026-02-22T02:00:00.000Z", "error"),
      source: "import",
      name: "Beta Outage",
      savedAt: "2026-02-22T02:10:00.000Z",
    });
    if (!beta.ok) {
      throw new Error("Expected save success");
    }

    const filtered = filterCaseLibraryEntries(beta.entries, { query: "beta outage" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe("Beta Outage");

    clearCaseLibraryStorage(createStorage());
  });
});
