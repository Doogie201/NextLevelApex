import { classifyDiagnose, parseDiagnoseLine } from "../diagnose";

describe("diagnose parser and classifier", () => {
  it("parses canonical one-line diagnose output", () => {
    const raw =
      'DNS_MODE=local-private RESOLVER=192.168.64.2 PIHOLE=running PIHOLE_UPSTREAM=host.docker.internal#5053 CLOUDFLARED=ok PLAINTEXT_DNS=no NOTES="ok"';

    const parsed = parseDiagnoseLine(raw);

    expect(parsed.dnsMode).toBe("local-private");
    expect(parsed.resolver).toBe("192.168.64.2");
    expect(parsed.pihole).toBe("running");
    expect(parsed.cloudflared).toBe("ok");
    expect(parsed.plaintextDns).toBe("no");
    expect(classifyDiagnose(parsed)).toBe("OK");
  });

  it("returns DEGRADED for unhealthy components", () => {
    const raw =
      'DNS_MODE=local-private RESOLVER=192.168.64.2 PIHOLE=missing PIHOLE_UPSTREAM=unknown CLOUDFLARED=down PLAINTEXT_DNS=unknown NOTES="degraded"';

    const parsed = parseDiagnoseLine(raw);
    expect(classifyDiagnose(parsed)).toBe("DEGRADED");
  });

  it("throws when required fields are missing", () => {
    expect(() => parseDiagnoseLine("DNS_MODE=local-private RESOLVER=192.168.64.2")).toThrow(
      /Missing diagnose field/,
    );
  });
});
