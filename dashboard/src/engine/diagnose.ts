export interface DiagnoseSummary {
  dnsMode: string;
  resolver: string;
  pihole: string;
  piholeUpstream: string;
  cloudflared: string;
  plaintextDns: string;
  notes: string;
}

export type HealthBadge = "OK" | "DEGRADED" | "BROKEN";

const REQUIRED_KEYS = [
  "DNS_MODE",
  "RESOLVER",
  "PIHOLE",
  "PIHOLE_UPSTREAM",
  "CLOUDFLARED",
  "PLAINTEXT_DNS",
  "NOTES",
] as const;

function parsePairs(line: string): Record<string, string> {
  const regex = /([A-Z_]+)=("(?:[^"\\]|\\.)*"|\S+)/g;
  const tokens: Record<string, string> = {};

  for (const match of line.matchAll(regex)) {
    const key = match[1];
    if (!key) {
      continue;
    }
    const rawValue = match[2] ?? "";
    tokens[key] = rawValue.startsWith('"') && rawValue.endsWith('"')
      ? rawValue.slice(1, -1)
      : rawValue;
  }

  return tokens;
}

export function parseDiagnoseLine(line: string): DiagnoseSummary {
  const trimmed = line.trim();
  if (!trimmed) {
    throw new Error("Diagnose output is empty.");
  }

  const parsed = parsePairs(trimmed);
  for (const key of REQUIRED_KEYS) {
    if (parsed[key] === undefined) {
      throw new Error(`Missing diagnose field: ${key}`);
    }
  }

  return {
    dnsMode: parsed.DNS_MODE!,
    resolver: parsed.RESOLVER!,
    pihole: parsed.PIHOLE!,
    piholeUpstream: parsed.PIHOLE_UPSTREAM!,
    cloudflared: parsed.CLOUDFLARED!,
    plaintextDns: parsed.PLAINTEXT_DNS!,
    notes: parsed.NOTES!,
  };
}

function isPrivateResolver(ip: string): boolean {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
}

export function classifyDiagnose(summary: DiagnoseSummary): HealthBadge {
  const modeIsExpected = summary.dnsMode === "local-private" || summary.dnsMode === "vpn-authoritative";
  const resolverIsExpected = isPrivateResolver(summary.resolver);

  if (
    modeIsExpected &&
    resolverIsExpected &&
    summary.pihole === "running" &&
    summary.cloudflared === "ok" &&
    summary.plaintextDns === "no"
  ) {
    return "OK";
  }

  return "DEGRADED";
}
