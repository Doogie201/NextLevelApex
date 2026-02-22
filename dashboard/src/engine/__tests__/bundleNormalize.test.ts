import { buildBundlePreviewText, normalizeBundleValue, stableStringifyNormalized } from "../bundleNormalize";

describe("bundleNormalize", () => {
  it("normalizes deterministically with stable key and array ordering", () => {
    const first = {
      b: [
        { id: "2", value: "beta" },
        { id: "1", value: "alpha" },
      ],
      a: "x",
    };

    const second = {
      a: "x",
      b: [
        { value: "alpha", id: "1" },
        { value: "beta", id: "2" },
      ],
    };

    const normalizedFirst = normalizeBundleValue(first).normalized;
    const normalizedSecond = normalizeBundleValue(second).normalized;

    expect(stableStringifyNormalized(normalizedFirst)).toBe(stableStringifyNormalized(normalizedSecond));
  });

  it("redacts secret-like content and truncates oversized strings", () => {
    const source = {
      note: "WEBPASSWORD=my-super-secret-value",
      token: "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
      path: "/Users/demo/.config/nextlevelapex/secrets.env",
    };

    const normalized = normalizeBundleValue(source, { maxStringLength: 120 });
    const serialized = stableStringifyNormalized(normalized.normalized);

    expect(serialized).toContain("WEBPASSWORD=[REDACTED]");
    expect(serialized).toContain("[REDACTED_TOKEN]");
    expect(serialized).toContain("[REDACTED_PATH]");

    const truncated = normalizeBundleValue({ note: "safe chunk ".repeat(20) }, { maxStringLength: 20 });
    expect(stableStringifyNormalized(truncated.normalized)).toContain("TRUNCATED");
  });

  it("enforces output truncation marker for very large previews", () => {
    const huge = {
      lines: Array.from({ length: 500 }, (_, index) => `line-${index}`),
    };

    const preview = buildBundlePreviewText(huge, {
      maxOutputChars: 200,
      maxArrayItems: 500,
      maxStringLength: 120,
    });

    expect(preview.truncated).toBe(true);
    expect(preview.text).toContain("TRUNCATED_OUTPUT");
  });
});
