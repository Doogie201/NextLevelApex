import { createRunSessionFromResult } from "../runSessions";
import {
  buildInvestigationBundle,
  buildInvestigationBundleJson,
  parseInvestigationBundleJson,
} from "../bundleExport";
import type { RunPreset } from "../presetsStore";
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

function buildSession(eventId: string, startedAt: string, commandId: CommandResponse["commandId"]) {
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

function buildPreset(): RunPreset {
  return {
    id: "preset-1",
    name: "Baseline",
    config: {
      commandId: "dryRunTask",
      taskNames: ["Security", "Cloudflared"],
      dryRun: true,
      toggles: { readOnly: true },
    },
    createdAt: "2026-02-22T01:00:00.000Z",
    updatedAt: "2026-02-22T01:00:00.000Z",
    lastUsedAt: null,
  };
}

describe("bundleExport", () => {
  it("builds deterministic bundle output with stable sorting", () => {
    const sessions = [
      buildSession("evt-b", "2026-02-21T22:31:00.000Z", "dryRunAll"),
      buildSession("evt-a", "2026-02-21T22:30:00.000Z", "diagnose"),
    ];
    const preset = buildPreset();

    const first = buildInvestigationBundleJson({
      guiVersionTag: "phase15",
      repo: "Doogie201/NextLevelApex",
      presetSelection: "preset",
      selectedPreset: preset,
      currentConfig: null,
      viewUrls: [
        "https://localhost:4010/?view=output&session=run-a&layout=focus-output&q=secret",
        "https://localhost:4010/?view=dashboard",
      ],
      sessions,
    });
    const second = buildInvestigationBundleJson({
      guiVersionTag: "phase15",
      repo: "Doogie201/NextLevelApex",
      presetSelection: "preset",
      selectedPreset: preset,
      currentConfig: null,
      viewUrls: [
        "https://localhost:4010/?view=dashboard",
        "https://localhost:4010/?view=output&session=run-a&layout=focus-output&q=secret",
      ],
      sessions: [...sessions].reverse(),
    });

    expect(first).toBe(second);

    const parsed = JSON.parse(first) as ReturnType<typeof buildInvestigationBundle>;
    expect(parsed.bundleKind).toBe("combined");
    expect(parsed.bundleId).toMatch(/^bundle-[a-f0-9]{8}$/);
    expect(parsed.views).toEqual([
      "https://localhost:4010/?view=dashboard",
      "https://localhost:4010/?view=output&session=run-a&layout=focus-output",
    ]);
    expect(parsed.sessions.map((item) => item.session.id)).toEqual(
      [...parsed.sessions.map((item) => item.session.id)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("validates schema, bundle kind, and bundle id integrity", () => {
    expect(parseInvestigationBundleJson("{")).toBeNull();
    expect(
      parseInvestigationBundleJson(
        JSON.stringify({
          bundleSchemaVersion: "v0",
          bundleKind: "combined",
          bundleId: "bundle-00000000",
          createdFrom: { guiVersionTag: "phase15" },
          preset: null,
          views: [],
          sessions: [],
          redacted: true,
        }),
      ),
    ).toBeNull();

    const valid = buildInvestigationBundleJson({
      guiVersionTag: "phase15",
      presetSelection: "none",
      selectedPreset: null,
      currentConfig: null,
      viewUrls: [],
      sessions: [],
    });

    expect(parseInvestigationBundleJson(valid)).not.toBeNull();

    const tampered = JSON.parse(valid) as Record<string, unknown>;
    tampered.bundleId = "bundle-deadbeef";
    expect(parseInvestigationBundleJson(JSON.stringify(tampered))).toBeNull();
  });

  it("never includes known unredacted fields in bundle output", () => {
    const session = buildSession("evt-sec", "2026-02-21T22:30:00.000Z", "dryRunTask");
    const json = buildInvestigationBundleJson({
      guiVersionTag: "phase15",
      presetSelection: "current",
      selectedPreset: null,
      currentConfig: {
        commandId: "dryRunTask",
        taskNames: ["Security"],
        dryRun: true,
        toggles: { readOnly: true },
      },
      viewUrls: ["https://localhost:4010/?view=output&session=abc&q=token"],
      sessions: [session],
    });

    expect(json).not.toContain("supersecret-value");
    expect(json).not.toContain("abcdef0123456789abcdef0123456789");
    expect(json).not.toContain('"stdout"');
    expect(json).not.toContain('"stderr"');
    expect(json).toContain("WEBPASSWORD=[REDACTED]");
    expect(json).toContain('"redacted": true');
  });
});
