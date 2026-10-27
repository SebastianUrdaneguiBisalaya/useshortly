// Prints a fresh Ed25519 key pair: the private key for this server, the public key for the API.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { publicKeyBase64 } from "../src/config.js";

const { privateKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

console.log("# apps/mcp/.env");
console.log(`MCP_SIGNING_KEY=${Buffer.from(pem).toString("base64")}`);
console.log(`AUTH_SECRET=${randomBytes(32).toString("base64url")}`);
console.log("\n# API .env");
console.log(`MCP_PUBLIC_KEY=${publicKeyBase64(privateKey)}`);
