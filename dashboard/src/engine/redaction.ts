const KEY_VALUE_PATTERNS = [
  /(WEBPASSWORD\s*=\s*)([^\s\"']+)/gi,
  /((?:api[_-]?key|token|secret|password)\s*[:=]\s*)([^\s\"']+)/gi,
];

const SECRET_PATH_PATTERN = /\/[A-Za-z0-9._\-/]*(?:secret|secrets|keychain|credentials)[A-Za-z0-9._\-/]*/gi;
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9+/_\-=]{32,}\b/g;

export function redactOutput(input: string): string {
  let redacted = input;

  for (const pattern of KEY_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "$1[REDACTED]");
  }

  redacted = redacted.replace(SECRET_PATH_PATTERN, "[REDACTED_PATH]");
  redacted = redacted.replace(LONG_TOKEN_PATTERN, "[REDACTED_TOKEN]");

  return redacted;
}
