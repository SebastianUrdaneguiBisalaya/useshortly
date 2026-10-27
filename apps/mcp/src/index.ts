import { loadConfig } from "./config.js";

const config = loadConfig();
console.log(`useshortly MCP (${config.environment}) will listen on ${config.publicUrl}`);
