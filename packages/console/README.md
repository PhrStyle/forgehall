# @forgehall/console

Web console for Forgehall: Vite + React 18 + TypeScript, TanStack Query and react-router. It reads the bus's console API (`/api/...`) and listens to its SSE stream for live updates.

## Run it

The bus runs in the Docker stack (see [Getting started](../../docs/getting-started.md)):

```bash
pnpm install
fh setup                                                                 # once: creates the admin token
docker compose -f infra/docker/compose.yaml -p forgehall up -d --build   # bus on 127.0.0.1:4545
pnpm --filter @forgehall/console dev                                     # http://localhost:5173
```

The dev and preview servers proxy `/api` (including the SSE stream) to `http://127.0.0.1:4545` and add the **admin token** to each request, read from `~/.forgehall/admin-token`. The token never reaches the browser bundle. If the console shows `401`, run `fh setup` and restart the server. Environment: `FORGEHALL_BUS_URL` points at another bus, `FORGEHALL_ADMIN_TOKEN` overrides the token file, and `FORGEHALL_HOME` the directory holding it.

Other scripts: `build` (typecheck + `vite build`), `typecheck`, `test`.

## What is real and what is a preview

- Real, from the bus: workspaces, agents and their status, threads, the message timeline with run markers, the runs table, the live activity feed of an agent's runs, usage meters (5-hour and 7-day), creating tasks, sending messages, the approval card, **permission requests** (Allow once, Always allow, Deny with a reason, in Waiting on you, the thread and the agent page) and the **Settings** toggle "Allow agents directly on this machine".
- Preview (sample data, marked with a badge): the agent Memory, Skills, Environment and Versions tabs, and the routing rules in Settings (a static copy of the docs).

Access control is the admin token: whoever holds it acts as you. A production build served by something other than the dev or preview server has no proxy to add the token and is not supported yet.
