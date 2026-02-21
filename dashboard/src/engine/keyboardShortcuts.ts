export const GO_SHORTCUT_TIMEOUT_MS = 800;

export type ShortcutAction =
  | "OPEN_HELP"
  | "CLOSE_HELP"
  | "FOCUS_SEARCH"
  | "VIEW_DASHBOARD"
  | "VIEW_TASKS"
  | "VIEW_OUTPUT"
  | null;

export interface ShortcutState {
  goPrefixAt: number | null;
}

export interface ShortcutInput {
  key: string;
  nowMs: number;
  isTypingTarget: boolean;
  isOutputView: boolean;
  hasSearchInput: boolean;
  isHelpOpen: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface ShortcutResult {
  nextState: ShortcutState;
  action: ShortcutAction;
}

export function initialShortcutState(): ShortcutState {
  return { goPrefixAt: null };
}

function normalizeKey(key: string): string {
  if (key.length === 1) {
    return key.toLowerCase();
  }
  return key.toLowerCase();
}

function isGoPrefixActive(state: ShortcutState, nowMs: number): boolean {
  if (state.goPrefixAt === null) {
    return false;
  }
  return nowMs - state.goPrefixAt <= GO_SHORTCUT_TIMEOUT_MS;
}

export function evaluateShortcut(state: ShortcutState, input: ShortcutInput): ShortcutResult {
  const key = normalizeKey(input.key);
  const goActive = isGoPrefixActive(state, input.nowMs);
  let nextState: ShortcutState = { goPrefixAt: goActive ? state.goPrefixAt : null };

  if (key === "escape" && input.isHelpOpen) {
    return {
      nextState: initialShortcutState(),
      action: "CLOSE_HELP",
    };
  }

  if (input.isHelpOpen) {
    return { nextState, action: null };
  }

  if (input.metaKey || input.ctrlKey || input.altKey) {
    return { nextState, action: null };
  }

  if (input.isTypingTarget) {
    return { nextState, action: null };
  }

  if (key === "?") {
    return {
      nextState: initialShortcutState(),
      action: "OPEN_HELP",
    };
  }

  if (key === "/" && input.isOutputView && input.hasSearchInput) {
    return {
      nextState: initialShortcutState(),
      action: "FOCUS_SEARCH",
    };
  }

  if (key === "g") {
    nextState = { goPrefixAt: input.nowMs };
    return { nextState, action: null };
  }

  if (goActive) {
    if (key === "d") {
      return { nextState: initialShortcutState(), action: "VIEW_DASHBOARD" };
    }
    if (key === "t") {
      return { nextState: initialShortcutState(), action: "VIEW_TASKS" };
    }
    if (key === "o") {
      return { nextState: initialShortcutState(), action: "VIEW_OUTPUT" };
    }
    return { nextState: initialShortcutState(), action: null };
  }

  return { nextState, action: null };
}
