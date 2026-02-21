import { redactOutput } from "../redaction";

describe("redactOutput", () => {
  it("redacts obvious secret key-value pairs", () => {
    const input = "WEBPASSWORD=abc123\napi_key: value123\ntoken=deadbeef";
    const output = redactOutput(input);

    expect(output).toContain("WEBPASSWORD=[REDACTED]");
    expect(output).toContain("api_key: [REDACTED]");
    expect(output).toContain("token=[REDACTED]");
  });

  it("redacts secret-looking paths and long tokens", () => {
    const input = "/Users/demo/.config/nextlevelapex/secrets.env\nabcdefghijklmnopqrstuvwxyz1234567890";
    const output = redactOutput(input);

    expect(output).toContain("[REDACTED_PATH]");
    expect(output).toContain("[REDACTED_TOKEN]");
  });
});
