import type { RunSession } from "./runSessions";

export interface SessionEventPair {
  eventId: string | null;
  sessionId: string | null;
}

/**
 * Resolve the canonical (eventId, sessionId) pair in a single pass.
 *
 * When both are provided, the sessionId is trusted as the more specific
 * selection and the eventId is derived from it. This prevents the
 * oscillation that occurs when two separate effects each try to derive
 * one value from the other.
 *
 * The function is idempotent: resolve(resolve(x)) === resolve(x).
 */
export function resolveSessionEventPair(
  sessions: ReadonlyArray<Pick<RunSession, "id" | "eventId">>,
  eventId: string | null,
  sessionId: string | null,
): SessionEventPair {
  if (!eventId && !sessionId) {
    return { eventId: null, sessionId: null };
  }

  // When sessionId is provided, it takes priority.
  if (sessionId) {
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      return { eventId: session.eventId, sessionId: session.id };
    }
    // Session not found — fall through to eventId lookup.
  }

  if (eventId) {
    const first = sessions.find((s) => s.eventId === eventId);
    return first
      ? { eventId, sessionId: first.id }
      : { eventId, sessionId: null };
  }

  return { eventId: null, sessionId: null };
}
