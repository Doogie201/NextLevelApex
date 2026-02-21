import { buildRedactedEventText, buildRedactedLogText } from "../outputExport";
import type { CommandEvent } from "../viewModel";

function sampleEvent(overrides: Partial<CommandEvent> = {}): CommandEvent {
  return {
    id: "evt-export",
    commandId: "dryRunAll",
    label: "Dry-Run Sweep",
    startedAt: "2026-02-21T20:00:00.000Z",
    finishedAt: "2026-02-21T20:00:05.000Z",
    durationMs: 5000,
    outcome: "WARN",
    note: "WEBPASSWORD=abc123",
    stdout: "token=abcdefghijklmnopqrstuvwxyz123456",
    stderr: "/Users/demo/.config/nextlevelapex/secrets.env",
    taskResults: [
      {
        taskName: "DNS Stack Sanity Check",
        status: "FAIL",
        reason: "api_key: secret-value",
      },
    ],
    ...overrides,
  };
}

describe("output export", () => {
  it("builds redacted copy/download payloads", () => {
    const event = sampleEvent();
    const exported = buildRedactedEventText(event);

    expect(exported).toContain("Command: Dry-Run Sweep");
    expect(exported).toContain("[REDACTED]");
    expect(exported).not.toContain("abc123");
    expect(exported).not.toContain("secret-value");
    expect(exported).not.toContain("/Users/demo/.config/nextlevelapex/secrets.env");
  });

  it("exports combined redacted logs for multiple events", () => {
    const output = buildRedactedLogText([
      sampleEvent(),
      sampleEvent({ id: "evt-2", label: "Diagnose" }),
    ]);

    expect(output).toContain("Command: Dry-Run Sweep");
    expect(output).toContain("Command: Diagnose");
    expect(output).toContain("---");
    expect(output).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });
});
