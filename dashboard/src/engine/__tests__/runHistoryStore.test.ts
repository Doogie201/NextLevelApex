import {
  addOrUpdateRunHistoryEntry,
  buildReplayConfigFromBundle,
  clearRunHistory,
  createRunHistoryEntryFromBundle,
  createRunHistoryEntryFromSession,
  loadRunHistory,
  parseHistoryBundle,
  RUN_HISTORY_STORAGE_KEY,
  storeRunHistory,
  toggleRunHistoryPinned,
  type RunHistoryStorageLike,
} from "../runHistoryStore";
import { buildBundleId, buildInvestigationBundle, type InvestigationBundle } from "../bundleExport";
import { createRunSessionFromResult } from "../runSessions";
import type { CommandResponse } from "../viewModel";

function createStorage(initial: string | null = null): RunHistoryStorageLike {
  let data = initial;
  return {
    getItem: () => data,
    setItem: (_key, value) => {
      data = value;
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

  it("uses expected storage key and supports clear", () => {
    expect(RUN_HISTORY_STORAGE_KEY).toBe("nlx.gui.runHistory.v1");
    expect(clearRunHistory()).toEqual([]);
  });
});
