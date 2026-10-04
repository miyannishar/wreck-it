import { describe, it, expect } from "vitest";
import { isAllowedTarget } from "../src/target.js";

describe("isAllowedTarget", () => {
  it.each([
    "http://localhost:3000", "http://127.0.0.1:8080/x", "http://[::1]:3000", "http://0x7f000001",
    "http://10.0.0.5", "http://172.20.1.1", "http://192.168.1.10:5173", "http://app.localhost", "http://0.0.0.0:3000",
  ])("allows %s", (u) => expect(isAllowedTarget(u).ok).toBe(true));
  it.each([
    "http://localhost.evil.com", "http://127.0.0.1.nip.io", "https://example.com", "http://172.32.0.1",
    "http://8.8.8.8", "ftp://localhost", "http://[2001:db8::1]",
  ])("rejects %s", (u) => expect(isAllowedTarget(u).ok).toBe(false));
  it("rejects malformed URLs without throwing", () => {
    for (const u of ["", "not a url", "http://", "://x"]) expect(isAllowedTarget(u).ok).toBe(false);
  });
  it("iOwnThis allows public http targets but never other protocols", () => {
    expect(isAllowedTarget("https://example.com", { iOwnThis: true }).ok).toBe(true);
    expect(isAllowedTarget("file:///etc/passwd", { iOwnThis: true }).ok).toBe(false);
  });
});
