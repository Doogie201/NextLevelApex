const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return LOCALHOST_HOSTS.has(normalized);
}

export function localhostWarning(hostname: string): string | null {
  if (isLocalhostHostname(hostname)) {
    return null;
  }
  return `Dashboard is running on non-local host (${hostname}). Use localhost-only binding for v1 safety.`;
}
