import type { CommandResponse } from "../viewModel";
import { createRunSessionFromResult } from "../runSessions";
import {
  buildSessionBundleExportJson,
  buildSessionExportJson,
  buildSessionOperatorReport,
} from "../sessionExport";

function buildResponse(overrides: Partial<CommandResponse> = {}): CommandResponse {
  return {
    ok: true,
    commandId: "dryRunAll",
    badge: "DEGRADED",
    reasonCode: "TIMEOUT",
    exitCode: 0,
    timedOut: true,
    errorType: "timeout",
    stdout: "WEBPASSWORD=top-secret",
    stderr: "",
    events: [
      { ts: "2026-02-21T22:15:01.000Z", level: "warn", msg: "token=abcdef0123456789abcdef0123456789" },
      { ts: "2026-02-21T22:15:00.500Z", level: "info", msg: "started" },
    ],
    redacted: true,
    taskNames: [],
    taskResults: [
      {
        taskName: "Cloudflared",
        status: "WARN",
        reason: "Retry against /Users/me/.config/secret/location",
      },
    ],
    diagnose: undefined,
    error: undefined,
    httpStatus: 200,
    ...overrides,
  };
}

describe("sessionExport", () => {
  it("exports single session json with deterministic shape", () => {
    const session = createRunSessionFromResult({
      eventId: "evt-1",
      commandId: "dryRunAll",
      label: "Dry-Run Sweep",
      note: "Command completed with warnings",
      startedAtMs: Date.parse("2026-02-21T22:15:00.000Z"),
      finishedAtIso: "2026-02-21T22:15:03.000Z",
      durationMs: 3000,
      result: buildResponse(),
    });

    const parsed = JSON.parse(buildSessionExportJson(session)) as Record<string, unknown>;
    expect(parsed.id).toBe(session.id);
    expect(parsed.commandId).toBe("dryRunAll");
    expect(parsed.redacted).toBe(true);
    expect(parsed.events).toBeInstanceOf(Array);
    expect((parsed.events as Array<{ offsetMs: number }>)[0]?.offsetMs).toBe(500);
    expect(buildSessionExportJson(session)).toContain("token=[REDACTED]");
    expect(buildSessionExportJson(session)).toContain("[REDACTED_PATH]");
  });

  it("exports bundle json in deterministic newest-first order", () => {
    const older = createRunSessionFromResult({
      eventId: "evt-older",
      commandId: "diagnose",
      label: "Diagnose",
      note: "ok",
      startedAtMs: Date.parse("2026-02-20T10:00:00.000Z"),
      finishedAtIso: "2026-02-20T10:00:01.000Z",
      durationMs: 1000,
      result: buildResponse({ commandId: "diagnose", badge: "OK", reasonCode: "SUCCESS", timedOut: false }),
    });
    const newer = createRunSessionFromResult({
      eventId: "evt-newer",
      commandId: "dryRunAll",
      label: "Dry-Run Sweep",
      note: "warn",
      startedAtMs: Date.parse("2026-02-21T10:00:00.000Z"),
      finishedAtIso: "2026-02-21T10:00:02.000Z",
      durationMs: 2000,
      result: buildResponse(),
    });

    const parsed = JSON.parse(buildSessionBundleExportJson([older, newer])) as Array<{ id: string }>;
    expect(parsed[0]?.id).toBe(newer.id);
    expect(parsed[1]?.id).toBe(older.id);
  });

  it("builds deterministic operator report text", () => {
    const session = createRunSessionFromResult({
      eventId: "evt-report",
      commandId: "dryRunTask",
      taskName: "Security",
      label: "Dry-Run Task: Security",
      note: "warn",
      startedAtMs: Date.parse("2026-02-21T22:15:00.000Z"),
      finishedAtIso: "2026-02-21T22:15:02.000Z",
      durationMs: 2000,
      result: buildResponse({ commandId: "dryRunTask" }),
    });

    const report = buildSessionOperatorReport(session);
    expect(report).toContain("NextLevelApex Operator Report");
    expect(report).toContain(`Session ID: ${session.id}`);
    expect(report).toContain("Command: dryRunTask");
    expect(report).toContain("Task: Security");
    expect(report).toContain("Redacted: yes");
    expect(report).toContain("token=[REDACTED]");
  });
});
