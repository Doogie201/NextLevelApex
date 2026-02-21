export function parseTaskNames(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.split("|")[0]?.trim() ?? "")
    .filter((value) => value.length > 0)
    .filter((value) => value !== "Task" && !value.startsWith("-"));
}

export function deriveTaskResult(stdout: string): "PASS" | "FAIL" | "WARN" | "SKIP" | "UNKNOWN" {
  if (stdout.includes("[PASS]")) {
    return "PASS";
  }
  if (stdout.includes("[FAIL")) {
    return "FAIL";
  }
  if (stdout.includes("[WARN")) {
    return "WARN";
  }
  if (stdout.includes("[SKIP]")) {
    return "SKIP";
  }
  return "UNKNOWN";
}
