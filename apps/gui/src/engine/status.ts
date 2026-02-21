import type { DiagnoseSummary, HealthBadgeStatus } from "./types";

function isPrivateResolver(value: string): boolean {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(value);
}

export function mapDiagnoseToBadge(summary: DiagnoseSummary): HealthBadgeStatus {
  const modeOk = summary.dnsMode === "local-private" || summary.dnsMode === "vpn-authoritative";
  const resolverOk = isPrivateResolver(summary.resolver);

  if (
    modeOk &&
    resolverOk &&
    summary.pihole === "running" &&
    summary.cloudflared === "ok" &&
    summary.plaintextDns === "no"
  ) {
    return "OK";
  }

  return "DEGRADED";
}
