import { describe, expect, it } from "vitest";
import { normalizePrivateKey } from "../src/chain/key.js";

const HEX = "ab".repeat(32); // 64 hex digits, obviously not a real key

describe("normalizePrivateKey", () => {
  it("leaves a proper 0x key alone", () => {
    expect(normalizePrivateKey("0x" + HEX, "K")).toBe("0x" + HEX);
  });
  it("adds the 0x prefix when it was left off (the mistake that crashed the deploy)", () => {
    expect(normalizePrivateKey(HEX, "K")).toBe("0x" + HEX);
  });
  it("tolerates surrounding spaces, a trailing newline and quotes", () => {
    expect(normalizePrivateKey(`  ${HEX}\n`, "K")).toBe("0x" + HEX);
    expect(normalizePrivateKey(`"0x${HEX}"`, "K")).toBe("0x" + HEX);
    expect(normalizePrivateKey(`'${HEX}'`, "K")).toBe("0x" + HEX);
  });
  it("returns undefined when unset or empty", () => {
    expect(normalizePrivateKey(undefined, "K")).toBeUndefined();
    expect(normalizePrivateKey("   ", "K")).toBeUndefined();
  });
  it("rejects a wrong length and says so without echoing the key", () => {
    const short = HEX.slice(0, 60);
    let msg = "";
    try {
      normalizePrivateKey(short, "AGENT_PRIVATE_KEY");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/AGENT_PRIVATE_KEY is not a valid private key/);
    expect(msg).toMatch(/found 60 characters/);
    expect(msg).not.toContain(short);
  });
  it("rejects non-hex characters", () => {
    expect(() => normalizePrivateKey("zz".repeat(32), "K")).toThrow(/non-hex/);
  });
});
