import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const BUS = process.env.FORGEHALL_BUS_URL ?? "http://127.0.0.1:4545";

/**
 * The console API needs the admin token. The dev/preview server adds it to proxied requests, so
 * the token never reaches the browser bundle. It is written by the bus or `fh setup`.
 */
function adminToken(): string {
  if (process.env.FORGEHALL_ADMIN_TOKEN) return process.env.FORGEHALL_ADMIN_TOKEN;
  const file = join(process.env.FORGEHALL_HOME ?? join(homedir(), ".forgehall"), "admin-token");
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    console.warn(`[forgehall] no admin token at ${file}: run \`fh setup\` (API calls will get 401)`);
    return "";
  }
}

// SSE (/api/events) passes through as a plain streamed response.
const proxy = {
  "/api": { target: BUS, changeOrigin: false, headers: { authorization: `Bearer ${adminToken()}` } },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
