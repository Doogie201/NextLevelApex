import { parseDiagnoseLine } from "../engine/diagnoseParser";

describe("parseDiagnoseLine", () => {
  it("parses the canonical single-line diagnose output", () => {
    const line =
      'DNS_MODE=local-private RESOLVER=192.168.64.2 PIHOLE=running PIHOLE_UPSTREAM=host.docker.internal#5053 CLOUDFLARED=ok PLAINTEXT_DNS=no NOTES="ok"';

    const parsed = parseDiagnoseLine(line);

    expect(parsed.dnsMode).toBe("local-private");
    expect(parsed.resolver).toBe("192.168.64.2");
    expect(parsed.pihole).toBe("running");
    expect(parsed.cloudflared).toBe("ok");
    expect(parsed.plaintextDns).toBe("no");
    expect(parsed.notes).toBe("ok");
  });

  it("throws if required fields are missing", () => {
    expect(() => parseDiagnoseLine("DNS_MODE=local-private RESOLVER=192.168.64.2")).toThrow(
      /Missing diagnose field/,
    );
  });
});
