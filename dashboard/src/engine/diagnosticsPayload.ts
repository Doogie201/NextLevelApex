import type { UrlViewId } from "./urlState";

export interface DiagnosticsPayloadInput {
  guiBuild: string;
  userAgent: string;
  readOnly: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  sessionCount: number;
  pinnedCount: number;
  activeView: UrlViewId;
  selectedSessionId: string | null;
}

export interface DiagnosticsPayload {
  guiBuild: string;
  userAgent: string;
  flags: {
    readOnly: boolean;
    highContrast: boolean;
    reducedMotion: boolean;
  };
  sessions: {
    total: number;
    pinned: number;
  };
  selection: {
    view: UrlViewId;
    sessionId: string | null;
  };
}

export function buildDiagnosticsPayload(input: DiagnosticsPayloadInput): DiagnosticsPayload {
  return {
    guiBuild: input.guiBuild,
    userAgent: input.userAgent,
    flags: {
      readOnly: input.readOnly,
      highContrast: input.highContrast,
      reducedMotion: input.reducedMotion,
    },
    sessions: {
      total: input.sessionCount,
      pinned: input.pinnedCount,
    },
    selection: {
      view: input.activeView,
      sessionId: input.selectedSessionId,
    },
  };
}

export function buildDiagnosticsText(input: DiagnosticsPayloadInput): string {
  const payload = buildDiagnosticsPayload(input);
  const lines = [
    `guiBuild=${payload.guiBuild}`,
    `userAgent=${payload.userAgent}`,
    `readOnly=${payload.flags.readOnly}`,
    `highContrast=${payload.flags.highContrast}`,
    `reducedMotion=${payload.flags.reducedMotion}`,
    `sessionCount=${payload.sessions.total}`,
    `pinnedCount=${payload.sessions.pinned}`,
    `view=${payload.selection.view}`,
    `selectedSessionId=${payload.selection.sessionId ?? "none"}`,
  ];
  return lines.join("\n");
}
