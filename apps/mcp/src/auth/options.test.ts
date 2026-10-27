import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { openLocal } from "../db/local.js";
import { authOptions } from "./options.js";

const env = {
  MCP_SIGNING_KEY: generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  AUTH_SECRET: "x".repeat(32),
};

describe("authOptions", () => {
  it("reads the client address from X-Forwarded-For only behind a trusted proxy", () => {
    const db = openLocal(":memory:");
    try {
      expect(authOptions(loadConfig({ ...env, TRUST_PROXY: "true" }), db).advanced.ipAddress.ipAddressHeaders).toEqual(["x-forwarded-for"]);
      expect(authOptions(loadConfig(env), db).advanced.ipAddress.ipAddressHeaders).toEqual([]);
    } finally {
      db.close();
    }
  });
});
