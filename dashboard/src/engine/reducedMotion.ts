export const REDUCED_MOTION_STORAGE_KEY = "nlx.gui.reduceMotion";

export function parseReducedMotionOverride(raw: string | null): boolean | null {
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return null;
}

export function resolveReducedMotionEffective(
  reducedMotionOverride: boolean | null,
  prefersReducedMotion: boolean,
): boolean {
  if (reducedMotionOverride === null) {
    return prefersReducedMotion;
  }
  return reducedMotionOverride;
}

export function nextReducedMotionOverride(currentOverride: boolean | null, prefersReducedMotion: boolean): boolean {
  return !(currentOverride ?? prefersReducedMotion);
}
