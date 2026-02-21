import { isLocalhostHostname, localhostWarning } from "../hostSafety";

describe("hostSafety", () => {
  it("treats loopback hosts as local", () => {
    expect(isLocalhostHostname("localhost")).toBe(true);
    expect(isLocalhostHostname("127.0.0.1")).toBe(true);
    expect(isLocalhostHostname("::1")).toBe(true);
    expect(isLocalhostHostname("[::1]")).toBe(true);
    expect(isLocalhostHostname("")).toBe(true);
  });

  it("flags non-loopback hosts", () => {
    expect(isLocalhostHostname("0.0.0.0")).toBe(false);
    expect(isLocalhostHostname("192.168.1.24")).toBe(false);
    expect(isLocalhostHostname("example.local")).toBe(false);
  });

  it("returns a warning string only for non-local hosts", () => {
    expect(localhostWarning("localhost")).toBeNull();
    expect(localhostWarning("127.0.0.1")).toBeNull();
    expect(localhostWarning("0.0.0.0")).toMatch(/non-local host/i);
  });
});
