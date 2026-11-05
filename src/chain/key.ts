/**
 * Turns a pasted private key into the 0x-prefixed form the crypto libraries need.
 * Accepts the usual paste variations (surrounding spaces or quotes, a missing 0x prefix).
 * On anything else it fails with a message that says what is wrong but never includes the key.
 */
export function normalizePrivateKey(raw: string | undefined, varName: string): `0x${string}` | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const cleaned = raw.trim().replace(/^["']|["']$/g, "").trim();
  const digits = cleaned.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(digits)) {
    throw new Error(`${varName} is not a valid private key: expected 64 hex digits (with or without a 0x prefix), found ${digits.length} characters${/^[0-9a-fA-F]*$/.test(digits) ? "" : " including non-hex characters"}.`);
  }
  return ("0x" + digits) as `0x${string}`;
}
