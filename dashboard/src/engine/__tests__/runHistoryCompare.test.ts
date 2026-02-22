import {
  buildRunHistoryShareSafeDiff,
  buildRunHistoryShareSafeDiffCopyText,
  buildRunHistoryShareSafeDiffFromExports,
  canCompareRunHistory,
  createRunHistoryCompareSelection,
  sanitizeRunHistoryCompareSelection,
  selectRunHistoryCompareRole,
  setRunHistoryCompareMode,
  swapRunHistoryCompareSelection,
} from "../runHistoryCompare";
import { createRunHistoryEntryFromSession, type RunHistoryEntry } from "../runHistoryStore";
import { createRunSessionFromResult } from "../runSessions";
import type { ShareSafeRunExport } from "../runShareSafeExport";
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
  return createRunHistoryEntryFromSession(session, "phase23");
}

function buildShareSafeExport(overrides: Partial<ShareSafeRunExport> = {}): ShareSafeRunExport {
  return {
    schemaVersion: "v1",
    runId: "run-a",
    bundleId: "bundle-a",
    bundleKind: "sessions",
    source: "session",
    commandId: "diagnose",
    status: "success",
    reasonCode: "SUCCESS",
    timestamp: "2026-02-22T03:00:00.000Z",
    input: {
      text: "mode=derived",
    },
    output: {
      text: "note: ready",
    },
    error: null,
    redacted: true,
    ...overrides,
  };
}

describe("runHistoryCompare", () => {
  it("derives compare inputs from share-safe export and rejects invalid history payloads", () => {
    const base = buildHistoryEntry("evt-base", "2026-02-22T03:10:00.000Z");
    const target = buildHistoryEntry("evt-target", "2026-02-22T03:11:00.000Z", {
      ok: false,
      badge: "BROKEN",
      reasonCode: "EXEC_ERROR",
      stderr: "error",
      events: [{ ts: "2026-02-22T03:11:01.000Z", level: "error", msg: "pipeline failed" }],
    });

    const compare = buildRunHistoryShareSafeDiff(base, target);
    expect(compare).not.toBeNull();
    expect(compare?.base.redacted).toBe(true);
    expect(compare?.target.redacted).toBe(true);

    const tampered: RunHistoryEntry = {
      ...target,
      bundleJson: target.bundleJson.replace("pipeline failed", "WEBPASSWORD=unsafe"),
    };
    expect(buildRunHistoryShareSafeDiff(base, tampered)).toBeNull();
  });

  it("produces deterministic diff output and stable path ordering", () => {
    const base = buildShareSafeExport({
      runId: "run-1",
      bundleId: "bundle-1",
      output: { text: "note: ready" },
      error: null,
    });
    const target = buildShareSafeExport({
      runId: "run-2",
      bundleId: "bundle-2",
      output: { text: "note: degraded" },
      error: { text: "reasonCode=EXEC_ERROR" },
      status: "error",
      reasonCode: "EXEC_ERROR",
    });

    const first = buildRunHistoryShareSafeDiffFromExports(base, target);
    const second = buildRunHistoryShareSafeDiffFromExports(base, target);
    expect(first.diff.entries).toEqual(second.diff.entries);
    expect(first.diff.summary).toEqual(second.diff.summary);

    const paths = first.diff.entries.map((entry) => entry.path);
    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)));
  });

  it("reports summary counts for added, removed, and changed changes", () => {
    const base = buildShareSafeExport({
      output: { text: "note: ready" },
      error: null,
    });
    const target = {
      ...buildShareSafeExport({
        output: { text: "note: ready" },
        error: { text: "reasonCode=EXEC_ERROR" },
      }),
      additional: "extra",
    } as ShareSafeRunExport & { additional: string };

    const compare = buildRunHistoryShareSafeDiffFromExports(base, target);
    expect(compare.diff.summary.changed).toBeGreaterThan(0);
    expect(compare.diff.summary.added).toBeGreaterThan(0);
    expect(compare.diff.summary.removed).toBe(0);

    const copy = buildRunHistoryShareSafeDiffCopyText(compare);
    expect(copy).toContain("schema=run-history-share-safe-diff.v1");
    expect(copy).toContain("summary.added=");
    expect(copy).toContain("changes:");
  });

  it("manages base/target selection transitions deterministically", () => {
    const runIds = ["run-a", "run-b", "run-c"];
    const disabled = createRunHistoryCompareSelection();
    expect(canCompareRunHistory(runIds)).toBe(true);

    const enabled = setRunHistoryCompareMode(disabled, true, runIds);
    expect(enabled.enabled).toBe(true);
    expect(enabled.baseRunId).toBe("run-a");
    expect(enabled.targetRunId).toBe("run-b");

    const selectedTarget = selectRunHistoryCompareRole(enabled, "target", "run-c", runIds);
    expect(selectedTarget.targetRunId).toBe("run-c");
    expect(selectedTarget.baseRunId).toBe("run-a");

    const swapped = swapRunHistoryCompareSelection(selectedTarget);
    expect(swapped.baseRunId).toBe("run-c");
    expect(swapped.targetRunId).toBe("run-a");

    const cleared = sanitizeRunHistoryCompareSelection(swapped, ["run-a"]);
    expect(cleared.enabled).toBe(false);
    expect(cleared.baseRunId).toBeNull();
    expect(cleared.targetRunId).toBeNull();
  });
});
