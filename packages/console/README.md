# @forgehall/console

Web console for Forgehall: Vite + React 18 + TypeScript, TanStack Query and react-router. It reads the bus's console API (`/api/...`) and listens to its SSE stream for live updates.

## Run it

```bash
pnpm install
node packages/bus/dist/index.js &          # bus on 127.0.0.1:4545 (after `pnpm build`)
pnpm --filter @forgehall/console dev       # http://localhost:5173
```

The dev server proxies `/api` (including the SSE stream) to `http://127.0.0.1:4545`. To point at another bus, set `FORGEHALL_BUS_URL` before starting it.

Other scripts: `build` (typecheck + `vite build`), `typecheck`, `test`.

## What is real and what is a preview

- Real, from the bus: workspaces, agents and their status, threads, the message timeline with run markers, the runs table, the live activity feed of an agent's runs, usage meters (5-hour and 7-day), creating tasks, and sending messages. The basic approval card posts a `decision` message.
- Preview (sample data, marked with a badge): the agent Memory, Skills, Environment and Versions tabs, and Settings (routing rules are a static copy of the docs).

There is no authentication yet. The console assumes the bus is on loopback.
