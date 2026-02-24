import { resolveSessionEventPair } from "../sessionEventSync";

interface Stub {
  id: string;
  eventId: string;
}

function stub(id: string, eventId: string): Stub {
  return { id, eventId };
}

describe("resolveSessionEventPair", () => {
  const sessions: Stub[] = [
    stub("S1", "E1"),
    stub("S2", "E1"), // second session for same event
    stub("S3", "E2"),
  ];

  it("returns nulls when both inputs are null", () => {
    expect(resolveSessionEventPair(sessions, null, null)).toEqual({
      eventId: null,
      sessionId: null,
    });
  });

  it("resolves eventId to its first session when no sessionId provided", () => {
    expect(resolveSessionEventPair(sessions, "E1", null)).toEqual({
      eventId: "E1",
      sessionId: "S1",
    });
  });

  it("preserves a valid sessionId and derives its eventId", () => {
    // S2 belongs to E1 — the function must keep S2, not override with S1.
    expect(resolveSessionEventPair(sessions, "E1", "S2")).toEqual({
      eventId: "E1",
      sessionId: "S2",
    });
  });

  it("derives eventId from sessionId when eventId is null", () => {
    expect(resolveSessionEventPair(sessions, null, "S3")).toEqual({
      eventId: "E2",
      sessionId: "S3",
    });
  });

  it("falls back to eventId lookup when sessionId not found", () => {
    expect(resolveSessionEventPair(sessions, "E2", "GONE")).toEqual({
      eventId: "E2",
      sessionId: "S3",
    });
  });

  it("returns eventId with null sessionId when event has no sessions", () => {
    expect(resolveSessionEventPair(sessions, "E99", null)).toEqual({
      eventId: "E99",
      sessionId: null,
    });
  });

  it("returns nulls when sessionId not found and no eventId", () => {
    expect(resolveSessionEventPair(sessions, null, "GONE")).toEqual({
      eventId: null,
      sessionId: null,
    });
  });

  it("is idempotent — running the output back through produces the same result", () => {
    // This is THE regression test for the feedback loop.
    // If resolve(resolve(input)) !== resolve(input), effects will oscillate.
    const inputs: Array<{ eventId: string | null; sessionId: string | null }> = [
      { eventId: "E1", sessionId: "S2" },
      { eventId: "E1", sessionId: null },
      { eventId: null, sessionId: "S3" },
      { eventId: "E1", sessionId: "GONE" },
      { eventId: null, sessionId: null },
      { eventId: "E99", sessionId: null },
    ];
    for (const input of inputs) {
      const first = resolveSessionEventPair(sessions, input.eventId, input.sessionId);
      const second = resolveSessionEventPair(sessions, first.eventId, first.sessionId);
      expect(second).toEqual(first);
    }
  });
});
