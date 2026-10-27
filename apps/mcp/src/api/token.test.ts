import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { audience, createTokenSigner, issuer, tokenTtlSeconds } from "./token.js";

const { privateKey } = generateKeyPairSync("ed25519");
const publicKey = createPublicKey(privateKey);

function decode(token: string) {
  const [h, p, s] = token.split(".") as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    payload: JSON.parse(Buffer.from(p, "base64url").toString()),
    validSignature: verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url")),
  };
}

describe("token signer", () => {
  it("signs an EdDSA token with the claims the API requires", () => {
    const sign = createTokenSigner(privateKey, () => 1_700_000_000_000);
    const { header, payload, validSignature } = decode(sign({ userId: 42, scope: "write" }));
    expect(validSignature).toBe(true);
    expect(header).toEqual({ alg: "EdDSA", typ: "JWT" });
    expect(payload).toMatchObject({
      iss: issuer,
      aud: audience,
      sub: "42",
      scope: "write",
      iat: 1_700_000_000,
      exp: 1_700_000_000 + tokenTtlSeconds,
    });
    expect(tokenTtlSeconds).toBeLessThanOrEqual(60);
  });

  it("never signs the same token twice", () => {
    const sign = createTokenSigner(privateKey);
    const a = sign({ userId: 1, scope: "read" });
    const b = sign({ userId: 1, scope: "read" });
    expect(a).not.toBe(b);
    expect(decode(a).payload.jti).not.toBe(decode(b).payload.jti);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("refuses user id %s", (userId) => {
    expect(() => createTokenSigner(privateKey)({ userId, scope: "read" })).toThrow("invalid API user id");
  });

  it("refuses a key that cannot sign for the API", () => {
    expect(() => createTokenSigner(publicKey)).toThrow("Ed25519 private key");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(() => createTokenSigner(rsa)).toThrow("Ed25519 private key");
  });
});
