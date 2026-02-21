export function isReadOnlyMode(): boolean {
  const value = process.env.NLX_GUI_READ_ONLY;
  if (value === undefined) {
    return true;
  }
  return value.toLowerCase() !== "false";
}
