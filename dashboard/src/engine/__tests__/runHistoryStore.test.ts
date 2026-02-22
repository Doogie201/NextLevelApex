import {
  addOrUpdateRunHistoryEntry,
  buildReplayConfigFromBundle,
  clearRunHistoryStorage,
  clearRunHistory,
  createRunHistoryEntryFromBundle,
  createRunHistoryEntryFromSession,
  filterRunHistoryEntries,
  loadRunHistory,
  loadRunHistorySelection,
  loadRunHistoryState,
  MAX_RUN_HISTORY_SERIALIZED_BYTES,
  MAX_RUN_HISTORY_ENTRIES,
  parseHistoryBundle,
  RUN_HISTORY_SCHEMA_VERSION,
  RUN_HISTORY_SELECTION_STORAGE_KEY,
  RUN_HISTORY_STORAGE_KEY,
  storeRunHistory,
  storeRunHistorySelection,
  toggleRunHistoryPinned,
  type RunHistoryStorageLike,
} from "../runHistoryStore";
import { buildBundleId, buildInvestigationBundle, type InvestigationBundle } from "../bundleExport";
import { createRunSessionFromResult } from "../runSessions";
import type { CommandResponse } from "../viewModel";

function createStorage(initial: string | null = null): RunHistoryStorageLike {
  const data = new Map<string, string | null>([[RUN_HISTORY_STORAGE_KEY, initial]]);
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (_key, value) => {
      data.set(_key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function buildResponse(overrides: Partial<CommandResponse> = {}): CommandResponse {
  return {
    ok: true,
    commandId: "dryRunTask",
    badge: "OK",
    reasonCode: "SUCCESS",
    exitCode: 0,
    timedOut: false,
    errorType: "none",
    stdout: "",
    stderr: "",
    events: [{ ts: "2026-02-22T02:00:00.000Z", level: "info", msg: "ready" }],
    redacted: true,
    taskNames: [],
    taskResults: [{ taskName: "Stack", status: "PASS", reason: "ok" }],
    diagnose: undefined,
    error: undefined,
    httpStatus: 200,
    ...overrides,
  };
}

function buildSession(eventId: string, startedAtIso: string, commandId: CommandResponse["commandId"] = "dryRunTask") {
  const startedAtMs = Date.parse(startedAtIso);
  return createRunSessionFromResult({
    eventId,
    commandId,
    taskName: commandId === "dryRunTask" ? "Stack" : undefined,
    label: `Run ${commandId}`,
    note: "Session complete",
    startedAtMs,
    finishedAtIso: new Date(startedAtMs + 1500).toISOString(),
    durationMs: 1500,
    result: buildResponse({ commandId }),
  });
}

describe("runHistoryStore", () => {
  it("stores and loads share-safe run history entries", () => {
    const session = buildSession("evt-1", "2026-02-22T01:00:00.000Z");
    const entry = createRunHistoryEntryFromSession(session, "phase18", "Doogie201/NextLevelApex");
    const storage = createStorage();

    storeRunHistory(storage, [entry]);
    const loaded = loadRunHistory(storage);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe(entry.id);
    expect(loaded[0]?.bundleId).toBe(entry.bundleId);
    expect(loaded[0]?.bundleLabel).toBe(session.label);
    expect(loaded[0]?.commandId).toBe(session.commandId);
  });

  it("builds replay config from bundle preset and falls back to session metadata", () => {
    const session = buildSession("evt-2", "2026-02-22T01:10:00.000Z", "dryRunTask");
    const presetBundle = buildInvestigationBundle({
      guiVersionTag: "phase18",
      presetSelection: "current",
      selectedPreset: null,
      currentConfig: {
        commandId: "dryRunTask",
        taskNames: ["Beta", "Alpha", "Alpha"],
        dryRun: true,
        toggles: { readOnly: true },
      },
      viewUrls: [],
      sessions: [session],
    });

    const fromPreset = buildReplayConfigFromBundle(presetBundle);
    expect(fromPreset).toEqual({
      commandId: "dryRunTask",
      taskNames: ["Alpha", "Beta"],
      dryRun: true,
      toggles: { readOnly: true },
    });

    const sessionOnlyBundle = buildInvestigationBundle({
      guiVersionTag: "phase18",
      presetSelection: "none",
      selectedPreset: null,
      currentConfig: null,
      viewUrls: [],
      sessions: [session],
    });
    const fromSession = buildReplayConfigFromBundle(sessionOnlyBundle);
    expect(fromSession?.commandId).toBe("dryRunTask");
    expect(fromSession?.taskNames).toEqual(["Stack"]);
  });

  it("drops invalid or unredacted-looking entries during load", () => {
    const session = buildSession("evt-3", "2026-02-22T01:20:00.000Z", "diagnose");
    const validEntry = createRunHistoryEntryFromSession(session, "phase18");
    const validBundle = parseHistoryBundle(validEntry);
    expect(validBundle).not.toBeNull();
    if (!validBundle) {
      throw new Error("Expected valid bundle");
    }

    const tamperedBundle: InvestigationBundle = {
      ...validBundle,
      sessions: validBundle.sessions.map((report, index) =>
        index === 0
          ? {
              ...report,
              session: {
                ...report.session,
                events: report.session.events.map((event, eventIndex) =>
                  eventIndex === 0 ? { ...event, msg: "WEBPASSWORD=unsafe-value" } : event,
                ),
              },
            }
          : report,
      ),
    };
    tamperedBundle.bundleId = buildBundleId({
      bundleSchemaVersion: tamperedBundle.bundleSchemaVersion,
      bundleKind: tamperedBundle.bundleKind,
      createdFrom: tamperedBundle.createdFrom,
      preset: tamperedBundle.preset,
      views: tamperedBundle.views,
      sessions: tamperedBundle.sessions,
      redacted: tamperedBundle.redacted,
    });

    const tamperedEntry = createRunHistoryEntryFromBundle(tamperedBundle, "import");
    const storage = createStorage(
      JSON.stringify({
        schemaVersion: 1,
        entries: [validEntry, tamperedEntry],
      }),
    );

    const loaded = loadRunHistory(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe(validEntry.id);
  });

  it("keeps deterministic ordering, stable ids, and pin toggles", () => {
    const early = createRunHistoryEntryFromSession(buildSession("evt-4", "2026-02-22T00:10:00.000Z"), "phase18");
    const latest = createRunHistoryEntryFromSession(buildSession("evt-5", "2026-02-22T00:20:00.000Z"), "phase18");
    const sameLatest = createRunHistoryEntryFromSession(buildSession("evt-5", "2026-02-22T00:20:00.000Z"), "phase18");

    expect(sameLatest.id).toBe(latest.id);

    const ordered = addOrUpdateRunHistoryEntry(addOrUpdateRunHistoryEntry([], early), latest);
    expect(ordered[0]?.id).toBe(latest.id);
    expect(ordered[1]?.id).toBe(early.id);

    const pinned = toggleRunHistoryPinned(ordered, early.id);
    expect(pinned[0]?.id).toBe(early.id);
    expect(pinned[0]?.pinned).toBe(true);
  });

  it("filters run history entries by query, status, and deterministic order", () => {
    const successSession = buildSession("evt-6", "2026-02-22T00:30:00.000Z", "dryRunTask");
    const errorSession = createRunSessionFromResult({
      eventId: "evt-7",
      commandId: "diagnose",
      label: "Run diagnose",
      note: "Session failed",
      startedAtMs: Date.parse("2026-02-22T00:40:00.000Z"),
      finishedAtIso: "2026-02-22T00:40:02.000Z",
      durationMs: 2000,
      result: buildResponse({
        commandId: "diagnose",
        ok: false,
        badge: "BROKEN",
        reasonCode: "EXEC_ERROR",
        stderr: "error",
        events: [{ ts: "2026-02-22T00:40:01.000Z", level: "error", msg: "pipeline failed" }],
      }),
    });

    const successEntry = createRunHistoryEntryFromSession(successSession, "phase19");
    const errorEntry = createRunHistoryEntryFromSession(errorSession, "phase19");
    const all = addOrUpdateRunHistoryEntry([successEntry], errorEntry);

    const errorOnly = filterRunHistoryEntries(all, { status: "error", order: "newest" });
    expect(errorOnly).toHaveLength(1);
    expect(errorOnly[0]?.id).toBe(errorEntry.id);

    const successByQuery = filterRunHistoryEntries(all, { query: "ready", status: "success", order: "newest" });
    expect(successByQuery).toHaveLength(1);
    expect(successByQuery[0]?.id).toBe(successEntry.id);

    const byOldest = filterRunHistoryEntries(all, { order: "oldest" });
    expect(byOldest[0]?.id).toBe(successEntry.id);
    expect(byOldest[1]?.id).toBe(errorEntry.id);
  });

  it("caps history entries and drops oldest first", () => {
    let entries = [] as ReturnType<typeof clearRunHistory>;

    for (let index = 0; index < MAX_RUN_HISTORY_ENTRIES + 5; index += 1) {
      const minute = String(index).padStart(2, "0");
      const session = buildSession(`evt-cap-${index}`, `2026-02-22T01:${minute}:00.000Z`, "dryRunTask");
      entries = addOrUpdateRunHistoryEntry(entries, createRunHistoryEntryFromSession(session, "phase19"));
    }

    expect(entries).toHaveLength(MAX_RUN_HISTORY_ENTRIES);

    const newest = entries[0];
    const oldest = entries[entries.length - 1];
    expect(newest?.startedAt).toBe("2026-02-22T01:44:00.000Z");
    expect(oldest?.startedAt).toBe("2026-02-22T01:05:00.000Z");
  });

  it("uses expected storage key and supports clear", () => {
    expect(RUN_HISTORY_STORAGE_KEY).toBe("nlx.gui.runHistory.v1");
    expect(clearRunHistory()).toEqual([]);
  });

  it("writes versioned envelope and persists only share-safe fields", () => {
    const session = buildSession("evt-safe", "2026-02-22T02:00:00.000Z", "diagnose");
    const entry = createRunHistoryEntryFromSession(session, "phase21");
    const storage = createStorage();

    storeRunHistory(storage, [entry]);
    const raw = storage.getItem(RUN_HISTORY_STORAGE_KEY);
    expect(raw).not.toBeNull();
    if (!raw) {
      throw new Error("Expected persisted run history payload");
    }

    const parsed = JSON.parse(raw) as { schemaVersion: number; entries: Array<Record<string, unknown>> };
    expect(parsed.schemaVersion).toBe(RUN_HISTORY_SCHEMA_VERSION);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.bundleJson).toBeTypeOf("string");
    expect(JSON.stringify(parsed.entries[0])).not.toContain("\"headers\"");
    expect(JSON.stringify(parsed.entries[0])).not.toContain("\"env\"");
  });

  it("migrates older schema payloads deterministically", () => {
    const session = buildSession("evt-mig", "2026-02-22T02:05:00.000Z");
    const entry = createRunHistoryEntryFromSession(session, "phase21");
    const storage = createStorage(
      JSON.stringify({
        schemaVersion: 1,
        entries: [entry],
      }),
    );

    const loadedState = loadRunHistoryState(storage);
    expect(loadedState.status).toBe("migrated");
    expect(loadedState.entries).toHaveLength(1);
    expect(loadedState.entries[0]?.id).toBe(entry.id);

    const persistedRaw = storage.getItem(RUN_HISTORY_STORAGE_KEY);
    expect(persistedRaw).not.toBeNull();
    if (!persistedRaw) {
      throw new Error("Expected migrated payload persisted");
    }
    const persisted = JSON.parse(persistedRaw) as { schemaVersion: number };
    expect(persisted.schemaVersion).toBe(RUN_HISTORY_SCHEMA_VERSION);
  });

  it("fails safe on corrupt payloads and clears storage", () => {
    const storage = createStorage("{invalid-json");

    const loadedState = loadRunHistoryState(storage);
    expect(loadedState.status).toBe("cleared_corrupt");
    expect(loadedState.entries).toEqual([]);
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("fails safe on newer schema versions without crashing", () => {
    const session = buildSession("evt-newer", "2026-02-22T02:06:00.000Z");
    const entry = createRunHistoryEntryFromSession(session, "phase21");
    const storage = createStorage(
      JSON.stringify({
        schemaVersion: RUN_HISTORY_SCHEMA_VERSION + 1,
        entries: [entry],
      }),
    );

    const loadedState = loadRunHistoryState(storage);
    expect(loadedState.status).toBe("ignored_newer_schema");
    expect(loadedState.entries).toEqual([]);
  });

  it("clears oversized persisted payloads before parsing", () => {
    const oversizeRaw = "x".repeat(MAX_RUN_HISTORY_SERIALIZED_BYTES + 100);
    const storage = createStorage(oversizeRaw);

    const loadedState = loadRunHistoryState(storage);
    expect(loadedState.status).toBe("cleared_oversize");
    expect(loadedState.entries).toEqual([]);
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("enforces serialized size budget and deterministic oldest-first eviction", () => {
    const entries: ReturnType<typeof clearRunHistory> = [];
    for (let index = 0; index < MAX_RUN_HISTORY_ENTRIES; index += 1) {
      const minute = String(index).padStart(2, "0");
      const session = buildSession(`evt-size-${index}`, `2026-02-22T03:${minute}:00.000Z`, "dryRunTask");
      const entry = createRunHistoryEntryFromSession(session, "phase21");
      const bundle = parseHistoryBundle(entry);
      if (!bundle) {
        throw new Error("Expected valid bundle");
      }
      const inflatedBundle: InvestigationBundle = {
        ...bundle,
        sessions: bundle.sessions.map((report, reportIndex) =>
          reportIndex === 0
            ? {
                ...report,
                session: {
                  ...report.session,
                  events: report.session.events.map((event, eventIndex) =>
                    eventIndex === 0
                      ? {
                          ...event,
                          msg: `diagnostic output ${index} ${"line ".repeat(2400)}`.trim(),
                        }
                      : event,
                  ),
                },
              }
            : report,
        ),
      };
      inflatedBundle.bundleId = buildBundleId({
        bundleSchemaVersion: inflatedBundle.bundleSchemaVersion,
        bundleKind: inflatedBundle.bundleKind,
        createdFrom: inflatedBundle.createdFrom,
        preset: inflatedBundle.preset,
        views: inflatedBundle.views,
        sessions: inflatedBundle.sessions,
        redacted: inflatedBundle.redacted,
      });

      entries.push(createRunHistoryEntryFromBundle(inflatedBundle, "session"));
    }

    const storage = createStorage();
    storeRunHistory(storage, entries);
    const raw = storage.getItem(RUN_HISTORY_STORAGE_KEY);
    expect(raw).not.toBeNull();
    if (!raw) {
      throw new Error("Expected run history payload");
    }
    expect(raw.length).toBeLessThanOrEqual(MAX_RUN_HISTORY_SERIALIZED_BYTES);

    const loaded = loadRunHistory(storage);
    expect(loaded.length).toBeLessThan(entries.length);

    const oldestKept = loaded[loaded.length - 1];
    expect(oldestKept?.startedAt).not.toBe("2026-02-22T03:00:00.000Z");
  });

  it("persists and clears selected run history id deterministically", () => {
    const storage = createStorage();
    expect(loadRunHistorySelection(storage)).toBeNull();

    storeRunHistorySelection(storage, "run-123");
    expect(loadRunHistorySelection(storage)).toBe("run-123");
    expect(storage.getItem(RUN_HISTORY_SELECTION_STORAGE_KEY)).toBe("run-123");

    storeRunHistorySelection(storage, null);
    expect(loadRunHistorySelection(storage)).toBeNull();

    storeRunHistorySelection(storage, "run-456");
    clearRunHistoryStorage(storage);
    expect(loadRunHistorySelection(storage)).toBeNull();
    expect(storage.getItem(RUN_HISTORY_STORAGE_KEY)).toBeNull();
  });
});
