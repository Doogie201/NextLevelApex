import { buildRunEnvelope, isRunEnvelope } from "../apiContract";

describe("apiContract", () => {
  it("builds deterministic envelopes with required fields", () => {
    const envelope = buildRunEnvelope({
      ok: true,
      badge: "OK",
      reasonCode: "SUCCESS",
      commandId: "diagnose",
      startedAt: "2026-02-21T21:20:00.000Z",
      stdout: "ok",
      stderr: "",
      events: [{ ts: "2026-02-21T21:20:00.100Z", level: "info", msg: "done" }],
    });

    expect(envelope.ok).toBe(true);
    expect(envelope.badge).toBe("OK");
    expect(envelope.reasonCode).toBe("SUCCESS");
    expect(typeof envelope.finishedAt).toBe("string");
    expect(typeof envelope.durationMs).toBe("number");
    expect(Array.isArray(envelope.events)).toBe(true);
    expect(isRunEnvelope(envelope)).toBe(true);
  });

  it("marks redacted=true and scrubs secret-like values", () => {
    const envelope = buildRunEnvelope({
      ok: false,
      badge: "BROKEN",
      reasonCode: "EXEC_ERROR",
      commandId: "dryRunAll",
      stdout: "WEBPASSWORD=topsecret",
      stderr: "token=abcdefghijklmnopqrstuvwxyz1234567890",
      events: [{ ts: "2026-02-21T21:20:00.200Z", level: "error", msg: "secret /tmp/credentials.txt" }],
    });

    expect(envelope.redacted).toBe(true);
    expect(envelope.stdout).not.toContain("topsecret");
    expect(envelope.stderr).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");
    expect(envelope.events[0]?.msg).not.toContain("credentials.txt");
  });

  it("rejects non-envelope payloads", () => {
    expect(isRunEnvelope(null)).toBe(false);
    expect(isRunEnvelope({})).toBe(false);
    expect(
      isRunEnvelope({
        ok: true,
        badge: "OK",
        reasonCode: "SUCCESS",
        commandId: "diagnose",
        stdout: "",
        stderr: "",
        events: [],
        redacted: false,
      }),
    ).toBe(true);
  });
});
