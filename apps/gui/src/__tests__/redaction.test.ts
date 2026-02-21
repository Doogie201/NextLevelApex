import { redactOutput } from "../engine/redaction";

describe("redactOutput", () => {
  it("redacts obvious key-value secrets and secret-looking paths", () => {
    const raw = [
      "WEBPASSWORD=supersecretvalue",
      "api_key: abc123",
      "token=abcd1234",
      "path=/Users/example/.config/nextlevelapex/secrets.env",
    ].join("\n");

    const redacted = redactOutput(raw);

    expect(redacted).toContain("WEBPASSWORD=[REDACTED]");
    expect(redacted).toContain("api_key: [REDACTED]");
    expect(redacted).toContain("token=[REDACTED]");
    expect(redacted).toContain("[REDACTED_PATH]");
  });

  it("redacts long token-like strings", () => {
    const raw = "jwt=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const redacted = redactOutput(raw);
    expect(redacted).toContain("[REDACTED_TOKEN]");
  });
});
