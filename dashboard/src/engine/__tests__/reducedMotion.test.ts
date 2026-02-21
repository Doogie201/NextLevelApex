import {
  nextReducedMotionOverride,
  parseReducedMotionOverride,
  resolveReducedMotionEffective,
} from "../reducedMotion";

describe("reducedMotion helpers", () => {
  it("parses stored boolean strings safely", () => {
    expect(parseReducedMotionOverride("true")).toBe(true);
    expect(parseReducedMotionOverride("false")).toBe(false);
    expect(parseReducedMotionOverride("TRUE")).toBeNull();
    expect(parseReducedMotionOverride("")).toBeNull();
    expect(parseReducedMotionOverride(null)).toBeNull();
  });

  it("resolves effective reduced motion with override precedence", () => {
    expect(resolveReducedMotionEffective(true, false)).toBe(true);
    expect(resolveReducedMotionEffective(false, true)).toBe(false);
    expect(resolveReducedMotionEffective(null, true)).toBe(true);
    expect(resolveReducedMotionEffective(null, false)).toBe(false);
  });

  it("toggles next override from override or OS preference", () => {
    expect(nextReducedMotionOverride(null, false)).toBe(true);
    expect(nextReducedMotionOverride(null, true)).toBe(false);
    expect(nextReducedMotionOverride(true, false)).toBe(false);
    expect(nextReducedMotionOverride(false, true)).toBe(true);
  });
});
