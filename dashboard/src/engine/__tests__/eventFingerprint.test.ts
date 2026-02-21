import { buildEventFingerprint } from "../eventFingerprint";

describe("eventFingerprint", () => {
  it("is deterministic for identical inputs", () => {
    const input = {
      severity: "ERROR" as const,
      label: "Dry-Run Sweep",
      message: "token=abcdef0123456789abcdef0123456789",
      reasonCode: "TIMEOUT",
    };

    expect(buildEventFingerprint(input)).toBe(buildEventFingerprint(input));
  });

  it("normalizes whitespace, casing, and first-line content", () => {
    const first = buildEventFingerprint({
      severity: "WARN",
      label: "  Diagnose ",
      message: "Cloudflared not running \nmore details",
      reasonCode: "EXEC_ERROR",
    });
    const second = buildEventFingerprint({
      severity: "WARN",
      label: "diagnose",
      message: " cloudflared   not   running ",
      reasonCode: "EXEC_ERROR",
    });

    expect(first).toBe(second);
  });
});
