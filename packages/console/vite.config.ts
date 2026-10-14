import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const BUS = process.env.FORGEHALL_BUS_URL ?? "http://127.0.0.1:4545";

// SSE (/api/events) passes through as a plain streamed response.
const proxy = { "/api": { target: BUS, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
