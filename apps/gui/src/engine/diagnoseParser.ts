import type { DiagnoseSummary } from "./types";

const REQUIRED_KEYS = [
  "DNS_MODE",
  "RESOLVER",
  "PIHOLE",
  "PIHOLE_UPSTREAM",
  "CLOUDFLARED",
  "PLAINTEXT_DNS",
  "NOTES",
] as const;

function parseTokens(line: string): Record<string, string> {
  const pattern = /([A-Z_]+)=("(?:[^"\\]|\\.)*"|\S+)/g;
  const values: Record<string, string> = {};

  for (const match of line.matchAll(pattern)) {
    const key = match[1];
    if (!key) {
      continue;
    }
    const rawValue = match[2] ?? "";
    const value = rawValue.startsWith('"') && rawValue.endsWith('"')
      ? rawValue.slice(1, -1)
      : rawValue;
    values[key] = value;
  }

  return values;
}

export function parseDiagnoseLine(line: string): DiagnoseSummary {
  const trimmed = line.trim();
  if (!trimmed) {
    throw new Error("Diagnose output is empty.");
  }

  const tokens = parseTokens(trimmed);
  for (const key of REQUIRED_KEYS) {
    if (!(key in tokens)) {
      throw new Error(`Missing diagnose field: ${key}`);
    }
  }

  const get = (key: (typeof REQUIRED_KEYS)[number]): string => {
    const value = tokens[key];
    if (value === undefined) {
      throw new Error(`Missing diagnose field: ${key}`);
    }
    return value;
  };

  return {
    dnsMode: get("DNS_MODE"),
    resolver: get("RESOLVER"),
    pihole: get("PIHOLE"),
    piholeUpstream: get("PIHOLE_UPSTREAM"),
    cloudflared: get("CLOUDFLARED"),
    plaintextDns: get("PLAINTEXT_DNS"),
    notes: get("NOTES"),
  };
}
