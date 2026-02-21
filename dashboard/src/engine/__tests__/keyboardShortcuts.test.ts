import {
  evaluateShortcut,
  GO_SHORTCUT_TIMEOUT_MS,
  initialShortcutState,
  type ShortcutInput,
  type ShortcutState,
} from "../keyboardShortcuts";

function run(
  state: ShortcutState,
  overrides: Partial<ShortcutInput>,
): ReturnType<typeof evaluateShortcut> {
  return evaluateShortcut(state, {
    key: "",
    nowMs: 0,
    isTypingTarget: false,
    isOutputView: false,
    hasSearchInput: false,
    isHelpOpen: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  });
}

describe("keyboard shortcuts", () => {
  it("opens help on ? and closes on Escape", () => {
    const open = run(initialShortcutState(), { key: "?", nowMs: 100 });
    expect(open.action).toBe("OPEN_HELP");

    const close = run(initialShortcutState(), {
      key: "Escape",
      nowMs: 120,
      isHelpOpen: true,
    });
    expect(close.action).toBe("CLOSE_HELP");
  });

  it("focuses search only in output view", () => {
    const allowed = run(initialShortcutState(), {
      key: "/",
      nowMs: 100,
      isOutputView: true,
      hasSearchInput: true,
    });
    expect(allowed.action).toBe("FOCUS_SEARCH");

    const blocked = run(initialShortcutState(), {
      key: "/",
      nowMs: 100,
      isOutputView: false,
      hasSearchInput: true,
    });
    expect(blocked.action).toBeNull();
  });

  it("handles g chord navigation and timeout reset", () => {
    const prefix = run(initialShortcutState(), { key: "g", nowMs: 100 });
    expect(prefix.nextState.goPrefixAt).toBe(100);
    expect(prefix.action).toBeNull();

    const toOutput = run(prefix.nextState, { key: "o", nowMs: 300 });
    expect(toOutput.action).toBe("VIEW_OUTPUT");
    expect(toOutput.nextState.goPrefixAt).toBeNull();

    const expired = run({ goPrefixAt: 100 }, { key: "d", nowMs: 100 + GO_SHORTCUT_TIMEOUT_MS + 1 });
    expect(expired.action).toBeNull();
    expect(expired.nextState.goPrefixAt).toBeNull();
  });

  it("ignores shortcuts while typing or using modifier keys", () => {
    const typing = run(initialShortcutState(), {
      key: "?",
      nowMs: 100,
      isTypingTarget: true,
    });
    expect(typing.action).toBeNull();

    const modifier = run(initialShortcutState(), {
      key: "?",
      nowMs: 100,
      metaKey: true,
    });
    expect(modifier.action).toBeNull();
  });
});
