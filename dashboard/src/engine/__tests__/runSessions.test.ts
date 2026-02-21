import type { CommandResponse } from "../viewModel";
import {
  addRunSession,
  clearRunSessions,
  createRunSessionFromResult,
  createRunSessionId,
  filterRunSessions,
  loadRunSessions,
  RUN_SESSIONS_STORAGE_KEY,
  sortRunSessions,
  storeRunSessions,
  togglePinnedSession,
  type RunSessionStorageLike,
} from "../runSessions";

function createStorage(initial: string | null = null): RunSessionStorageLike & { raw: string | null } {
  return {
    raw: initial,
    getItem: () => initial ?? null,
    setItem: (_: string, value: string) => {
      initial = value;
    },
  };
}

function buildResponse(overrides: Partial<CommandResponse> = {}): CommandResponse {
  return {
    ok: true,
    commandId: "diagnose",
    badge: "OK",
    reasonCode: "SUCCESS",
    exitCode: 0,
    timedOut: false,
    errorType: "none",
    stdout: "ok",
    stderr: "",
    events: [
      {
        ts: "2026-02-21T22:10:00.000Z",
        level: "info",
        msg: "ready",
      },
    ],
    redacted: true,
    taskNames: [],
    taskResults: [],
    diagnose: undefined,
    error: undefined,
    httpStatus: 200,
    ...overrides,
  };
}

describe("runSessions", () => {
  it("generates stable session ids", () => {
    const first = createRunSessionId(1700000000000, "diagnose", "evt-123");
    const second = createRunSessionId(1700000000000, "diagnose", "evt-123");
    const third = createRunSessionId(1700000000001, "diagnose", "evt-123");

    expect(first).toBe("1700000000000-diagnose-evt-123");
    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  it("stores and loads schema envelope safely", () => {
    const session = createRunSessionFromResult({
      eventId: "evt-1",
      commandId: "diagnose",
      label: "Diagnose",
      note: "safe",
      startedAtMs: Date.parse("2026-02-21T22:10:00.000Z"),
      finishedAtIso: "2026-02-21T22:10:01.000Z",
      durationMs: 1000,
      result: buildResponse(),
    });

    const storage = createStorage();
    storeRunSessions(storage, [session]);
    const loaded = loadRunSessions(storage);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe(session.id);
    expect(loaded[0]?.events[0]?.msg).toBe("ready");
  });

  it("drops invalid schema and migrates legacy array payloads", () => {
    const badStorage = createStorage(JSON.stringify({ version: 2, sessions: [] }));
    expect(loadRunSessions(badStorage)).toEqual([]);

    const migrated = createRunSessionFromResult({
      eventId: "evt-2",
      commandId: "dryRunAll",
      label: "Dry-Run Sweep",
      note: "done",
      startedAtMs: Date.parse("2026-02-20T22:00:00.000Z"),
      finishedAtIso: "2026-02-20T22:00:04.000Z",
      durationMs: 4000,
      result: buildResponse({ commandId: "dryRunAll" }),
    });
    const legacyStorage = createStorage(JSON.stringify([migrated]));
    const loaded = loadRunSessions(legacyStorage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe(migrated.id);
  });

  it("supports deterministic filtering, pinning, and sorting", () => {
    const base = Date.parse("2026-02-21T22:00:00.000Z");
    const sessionA = createRunSessionFromResult({
      eventId: "evt-a",
      commandId: "diagnose",
      label: "Diagnose",
      note: "ok",
      startedAtMs: base,
      finishedAtIso: "2026-02-21T22:00:01.000Z",
      durationMs: 1000,
      result: buildResponse({ badge: "OK", reasonCode: "SUCCESS" }),
    });
    const sessionB = createRunSessionFromResult({
      eventId: "evt-b",
      commandId: "dryRunAll",
      label: "Dry-Run Sweep",
      note: "warn",
      startedAtMs: base + 2000,
      finishedAtIso: "2026-02-21T22:00:05.000Z",
      durationMs: 3000,
      result: buildResponse({ commandId: "dryRunAll", badge: "DEGRADED", reasonCode: "TIMEOUT", ok: false }),
    });

    const combined = addRunSession(addRunSession([], sessionA), sessionB);
    expect(combined[0]?.id).toBe(sessionB.id);

    const filtered = filterRunSessions(combined, {
      commandId: "dryRunAll",
      badge: "ALL",
      degradedOnly: true,
      timeRange: "all",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(sessionB.id);

    const pinned = togglePinnedSession(combined, sessionA.id);
    const sorted = sortRunSessions(pinned);
    expect(sorted[0]?.id).toBe(sessionA.id);
  });

  it("clears sessions deterministically", () => {
    expect(clearRunSessions()).toEqual([]);
  });

  it("uses expected storage key", () => {
    expect(RUN_SESSIONS_STORAGE_KEY).toBe("nlx.gui.runSessions.v1");
  });
});
