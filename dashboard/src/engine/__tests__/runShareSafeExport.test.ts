import { createRunSessionFromResult } from "../runSessions";
import { createRunHistoryEntryFromSession, addOrUpdateRunHistoryEntry, type RunHistoryEntry } from "../runHistoryStore";
import {
  buildRunDetailsModel,
  buildShareSafeRunExportJson,
  resolveRunHistorySelection,
  truncateRunDetails,
} from "../runShareSafeExport";
import type { CommandResponse } from "../viewModel";

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
    events: [{ ts: "2026-02-22T03:00:00.000Z", level: "info", msg: "ready" }],
    redacted: true,
    taskNames: [],
    taskResults: [{ taskName: "Stack", status: "PASS", reason: "ok" }],
    diagnose: undefined,
    error: undefined,
    httpStatus: 200,
    ...overrides,
  };
}

function buildHistoryEntry(eventId: string, startedAtIso: string, response: Partial<CommandResponse> = {}): RunHistoryEntry {
  const startedAtMs = Date.parse(startedAtIso);
  const session = createRunSessionFromResult({
    eventId,
    commandId: (response.commandId ?? "dryRunTask") as CommandResponse["commandId"],
    taskName: "Stack",
    label: "Run dryRunTask",
    note: "Session complete",
    startedAtMs,
    finishedAtIso: new Date(startedAtMs + 1000).toISOString(),
    durationMs: 1000,
    result: buildResponse(response),
  });
  return createRunHistoryEntryFromSession(session, "phase20");
}

describe("runShareSafeExport", () => {
  it("builds deterministic share-safe export json without internal fields", () => {
    const entry = buildHistoryEntry("evt-1", "2026-02-22T03:10:00.000Z");

    const first = buildShareSafeRunExportJson(entry);
    const second = buildShareSafeRunExportJson(entry);

    expect(first).not.toBeNull();
    expect(first).toBe(second);
    expect(first).toContain("\"schemaVersion\": \"v1\"");
    expect(first).toContain("\"runId\"");
    expect(first).not.toContain("bundleJson");
    expect(first).not.toContain("\"headers\"");
    expect(first).not.toContain("\"env\"");
  });

  it("rejects export when bundle payload violates redaction invariants", () => {
    const entry = buildHistoryEntry("evt-unredacted", "2026-02-22T03:11:00.000Z");
    const tamperedEntry: RunHistoryEntry = {
      ...entry,
      bundleJson: entry.bundleJson.replace("ready", "WEBPASSWORD=unsafe-value"),
    };

    expect(buildRunDetailsModel(tamperedEntry)).toBeNull();
    expect(buildShareSafeRunExportJson(tamperedEntry)).toBeNull();
  });

  it("truncates long text predictably", () => {
    const short = truncateRunDetails("abc", 3);
    expect(short).toEqual({ text: "abc", truncated: false });

    const long = truncateRunDetails("abcd", 3);
    expect(long.truncated).toBe(true);
    expect(long.text).toContain("… (truncated; expand to view more)");
    expect(long.text.startsWith("abc")).toBe(true);
  });

  it("resolves run selection deterministically for clear and eviction paths", () => {
    const first = buildHistoryEntry("evt-2", "2026-02-22T03:20:00.000Z");
    const second = buildHistoryEntry("evt-3", "2026-02-22T03:30:00.000Z");
    const entries = addOrUpdateRunHistoryEntry(addOrUpdateRunHistoryEntry([], first), second);

    expect(resolveRunHistorySelection(entries, null)).toBeNull();
    expect(resolveRunHistorySelection(entries, second.id)).toBe(second.id);
    expect(resolveRunHistorySelection([first], second.id)).toBeNull();
    expect(resolveRunHistorySelection([], second.id)).toBeNull();
  });

  it("builds run details with stable status + safe fields", () => {
    const entry = buildHistoryEntry("evt-4", "2026-02-22T03:40:00.000Z", {
      ok: false,
      badge: "BROKEN",
      reasonCode: "EXEC_ERROR",
      stderr: "error",
      events: [{ ts: "2026-02-22T03:40:01.000Z", level: "error", msg: "dial tcp 8.8.8.8:53 failed" }],
    });

    const details = buildRunDetailsModel(entry);
    expect(details).not.toBeNull();
    expect(details?.status).toBe("error");
    expect(details?.outputText).toContain("dial tcp");
    expect(details?.errorText).toContain("dial tcp");
  });
});
