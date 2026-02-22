import {
  applyInvestigationBundleImport,
  previewInvestigationBundleImport,
  validateInvestigationBundleInput,
} from "../bundleImport";
import { buildBundleId, buildInvestigationBundleJson, parseInvestigationBundleJson } from "../bundleExport";
import { buildRunPreset, type RunPreset } from "../presetsStore";
import { createRunSessionFromResult, type RunSession } from "../runSessions";
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
    events: [{ ts: "2026-02-21T22:30:00.000Z", level: "warn", msg: "WEBPASSWORD=supersecret-value" }],
    redacted: true,
    taskNames: [],
    taskResults: [{ taskName: "Security", status: "WARN", reason: "token=abcdef0123456789abcdef0123456789" }],
    diagnose: undefined,
    error: undefined,
    httpStatus: 200,
    ...overrides,
  };
}

function buildSession(eventId: string, startedAt: string, commandId: CommandResponse["commandId"]): RunSession {
  const startedAtMs = Date.parse(startedAt);
  return createRunSessionFromResult({
    eventId,
    commandId,
    taskName: commandId === "dryRunTask" ? "Security" : undefined,
    label: `Run ${commandId}`,
    note: "session note",
    startedAtMs,
    finishedAtIso: new Date(startedAtMs + 1500).toISOString(),
    durationMs: 1500,
    result: buildResponse({ commandId }),
  });
}

function buildPreset(id: string, name: string): RunPreset {
  return buildRunPreset({
    id,
    name,
    config: {
      commandId: "dryRunTask",
      taskNames: ["Security"],
      dryRun: true,
      toggles: { readOnly: true },
    },
    timestampIso: "2026-02-22T01:00:00.000Z",
  });
}

describe("bundleImport", () => {
  it("validates a bundle and previews duplicate counts", () => {
    const existingSession = buildSession("evt-1", "2026-02-21T22:30:00.000Z", "diagnose");
    const incomingSession = buildSession("evt-2", "2026-02-21T22:31:00.000Z", "dryRunTask");
    const existingPreset = buildPreset("preset-a", "Existing");
    const selectedPreset = buildPreset("preset-a", "Existing");

    const bundleJson = buildInvestigationBundleJson({
      guiVersionTag: "phase16",
      repo: "Doogie201/NextLevelApex",
      presetSelection: "preset",
      selectedPreset,
      currentConfig: null,
      viewUrls: ["https://localhost:4010/?view=output&session=run-1"],
      sessions: [existingSession, incomingSession],
    });

    const validated = validateInvestigationBundleInput(bundleJson);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error("validation unexpectedly failed");
    }

    const preview = previewInvestigationBundleImport(validated.bundle, [existingPreset], [existingSession]);
    expect(preview.presetCandidates).toBe(1);
    expect(preview.sessionCandidates).toBe(2);
    expect(preview.duplicatePresets).toBe(1);
    expect(preview.duplicateSessions).toBe(1);
  });

  it("imports presets and sessions with deterministic dedupe", () => {
    const existingSession = buildSession("evt-1", "2026-02-21T22:30:00.000Z", "diagnose");
    const incomingSession = buildSession("evt-2", "2026-02-21T22:31:00.000Z", "dryRunTask");
    const existingPreset = buildPreset("preset-existing", "Existing");
    const incomingPreset = buildPreset("preset-import", "Imported");

    const bundle = parseInvestigationBundleJson(
      buildInvestigationBundleJson({
        guiVersionTag: "phase16",
        repo: "Doogie201/NextLevelApex",
        presetSelection: "preset",
        selectedPreset: incomingPreset,
        currentConfig: null,
        viewUrls: ["https://localhost:4010/?view=output&session=run-1"],
        sessions: [existingSession, incomingSession],
      }),
    );
    expect(bundle).not.toBeNull();
    if (!bundle) {
      throw new Error("bundle parse failed");
    }

    const applied = applyInvestigationBundleImport({
      bundle,
      existingPresets: [existingPreset],
      existingSessions: [existingSession],
    });

    expect(applied.addedPresets).toBe(1);
    expect(applied.skippedPresets).toBe(0);
    expect(applied.addedSessions).toBe(1);
    expect(applied.skippedSessions).toBe(1);
    expect(applied.presets.some((preset) => preset.id === "preset-import")).toBe(true);
    expect(applied.sessions.some((session) => session.id === incomingSession.id)).toBe(true);
  });

  it("rejects unknown schema versions", () => {
    const validJson = buildInvestigationBundleJson({
      guiVersionTag: "phase16",
      presetSelection: "none",
      selectedPreset: null,
      currentConfig: null,
      viewUrls: [],
      sessions: [],
    });

    const parsed = JSON.parse(validJson) as Record<string, unknown>;
    parsed.bundleSchemaVersion = "v9";

    const validation = validateInvestigationBundleInput(JSON.stringify(parsed));
    expect(validation.ok).toBe(false);
    if (validation.ok) {
      throw new Error("validation unexpectedly succeeded");
    }
    expect(validation.errors[0]?.code).toBe("INVALID_SCHEMA");
  });

  it("rejects unredacted-looking content", () => {
    const session = buildSession("evt-x", "2026-02-21T22:32:00.000Z", "dryRunTask");
    const json = buildInvestigationBundleJson({
      guiVersionTag: "phase16",
      presetSelection: "none",
      selectedPreset: null,
      currentConfig: null,
      viewUrls: [],
      sessions: [session],
    });

    const parsed = parseInvestigationBundleJson(json);
    expect(parsed).not.toBeNull();
    if (!parsed) {
      throw new Error("bundle parse failed");
    }

    parsed.sessions[0]!.session.events[0]!.msg = "WEBPASSWORD=leaked-value";
    parsed.bundleId = buildBundleId({
      bundleSchemaVersion: parsed.bundleSchemaVersion,
      bundleKind: parsed.bundleKind,
      createdFrom: parsed.createdFrom,
      preset: parsed.preset,
      views: parsed.views,
      sessions: parsed.sessions,
      redacted: parsed.redacted,
    });

    const validation = validateInvestigationBundleInput(JSON.stringify(parsed));
    expect(validation.ok).toBe(false);
    if (validation.ok) {
      throw new Error("validation unexpectedly succeeded");
    }
    expect(validation.errors.some((error) => error.code === "UNREDACTED_CONTENT")).toBe(true);
  });
});
