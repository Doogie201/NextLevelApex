import { COMMAND_HISTORY_STORAGE_KEY, loadCommandHistory, storeCommandHistory } from "../historyStore";
import type { CommandEvent } from "../viewModel";

function sampleEvent(overrides: Partial<CommandEvent> = {}): CommandEvent {
  return {
    id: "evt-1",
    commandId: "diagnose",
    label: "Diagnose",
    startedAt: "2026-02-21T20:00:00.000Z",
    finishedAt: "2026-02-21T20:00:01.000Z",
    durationMs: 1000,
    outcome: "PASS",
    note: "WEBPASSWORD=secret123",
    stdout: "token=abc12345678901234567890123456789",
    stderr: "/Users/demo/.config/nextlevelapex/secrets.env",
    taskResults: [],
    ...overrides,
  };
}

describe("history storage", () => {
  it("stores redacted command history", () => {
    const state = new Map<string, string>();
    const storage = {
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => {
        state.set(key, value);
      },
    };

    storeCommandHistory(storage, [sampleEvent()]);
    const raw = state.get(COMMAND_HISTORY_STORAGE_KEY) ?? "";

    expect(raw).toContain("[REDACTED]");
    expect(raw).not.toContain("secret123");
    expect(raw).not.toContain("abc12345678901234567890123456789");
    expect(raw).not.toContain("/Users/demo/.config/nextlevelapex/secrets.env");
  });

  it("loads only valid events", () => {
    const valid = sampleEvent();
    const storage = {
      getItem: () => JSON.stringify([valid, { nope: true }]),
      setItem: () => undefined,
    };

    const loaded = loadCommandHistory(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("evt-1");
  });
});
