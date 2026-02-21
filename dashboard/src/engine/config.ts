export function isReadOnlyMode(): boolean {
  const value = process.env.NLX_GUI_READ_ONLY;
  if (value === undefined) {
    return true;
  }
  return value.toLowerCase() !== "false";
}

export const MUTATING_ACTIONS = new Set([
  "run",
  "autofix",
  "reset",
  "export",
  "install",
  "install-sudoers",
  "networksetup",
  "docker-rm",
  "colima",
  "launchctl",
  "archive",
  "install-archiver",
]);
