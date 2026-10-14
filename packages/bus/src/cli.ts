#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { HUMAN, Model } from "@forgehall/shared";
import { connect, migrate } from "./db.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAdminToken } from "./admin.js";
import { dockerIsRootless } from "./agent-network.js";
import { forgehallHome } from "./git.js";
import { type Isolation, listAgents, startAgent, stopAgent } from "./isolation.js";
import { Store } from "./store.js";

const USAGE = `fh — Forgehall operations

  fh setup                                  prepares ~/.forgehall and the Docker stack settings
  fh migrate
  fh workspace add <id> <name>
  fh agent add <ws> <id> --name <name> --role <role> [--model sonnet] [--prompt-file agent.md] [--accepts a,b]
  fh agent token <ws> <id>                 generates a new token (invalidates the previous one)
  fh agent run <ws> <id> [--isolation docker]   starts the agent isolated (container now, VM later)
  fh agent stop <ws> <id>
  fh agent ps
  fh repo add <ws> <id> <upstream> [--base main]   upstream: local path or git URL
  fh repos <ws>
  fh send <ws> <agent> <text> [--title <title>] [--severity high] [--repo <id>]
  fh reply <thread> <text> [--to <agent>] [--type answer|decision|request] [--re <message_id>]
  fh threads <ws> [--state <state>]
  fh thread <id>
  fh runs <ws>
  fh usage <ws>`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: "string" },
      role: { type: "string" },
      model: { type: "string" },
      "prompt-file": { type: "string" },
      accepts: { type: "string" },
      title: { type: "string" },
      severity: { type: "string" },
      to: { type: "string" },
      type: { type: "string" },
      re: { type: "string" },
      state: { type: "string" },
      repo: { type: "string" },
      isolation: { type: "string" },
      base: { type: "string" },
    },
  });
  const [cmd, sub, ...rest] = positionals;
  if (!cmd || cmd === "help") return console.log(USAGE);

  const sql = connect();
  const store = new Store(sql);
  try {
    switch (cmd) {
      case "migrate": {
        const applied = await migrate(sql);
        console.log(applied.length ? `applied: ${applied.join(", ")}` : "nothing to apply");
        break;
      }
      case "workspace": {
        const [id, ...name] = rest;
        if (sub !== "add" || !id) throw new Error(USAGE);
        await store.upsertWorkspace(id, name.join(" ") || id);
        console.log(`workspace ${id} ok`);
        break;
      }
      case "agent": {
        if (sub === "ps") {
          console.log(await listAgents());
          break;
        }
        const [ws, id] = rest;
        if (!ws || !id) throw new Error(USAGE);
        if (sub === "run") {
          if (!(await store.agent(ws, id))) throw new Error(`agent ${ws}/${id} does not exist`);
          const isolation = (values.isolation ?? "docker") as Isolation;
          // The bus may run in a container with its own data path; on the host, tokens are under ~/.forgehall.
          const account = await store.workspaceToken(ws);
          const container = await startAgent({ workspace: ws, agent: id, agentToken: await store.issueAgentToken(ws, id), isolation, billing: process.env.FORGEHALL_BILLING, workspaceToken: account?.token ?? null });
          console.log(`${ws}/${id} running isolated (${isolation}, ${container}). Logs: docker logs -f fh-${ws}-${id}`);
          break;
        }
        if (sub === "stop") {
          console.log((await stopAgent(ws, id)) ? `${ws}/${id} stopped` : `${ws}/${id} was not running`);
          break;
        }
        if (sub === "add") {
          await store.upsertAgent({
            workspaceId: ws,
            id,
            name: values.name ?? id,
            role: values.role ?? "",
            defaultModel: Model.parse(values.model ?? "sonnet"),
            acceptsFrom: values.accepts ? values.accepts.split(",") : [],
            prompt: values["prompt-file"] ? await readFile(values["prompt-file"], "utf8") : "",
          });
          console.log(`agent ${ws}/${id} ok`);
        } else if (sub === "token") {
          console.log(await store.issueAgentToken(ws, id));
        } else throw new Error(USAGE);
        break;
      }
      case "setup": {
        await setup();
        break;
      }
      case "repo": {
        const [ws, id, upstream] = rest;
        if (sub !== "add" || !ws || !id || !upstream) throw new Error(USAGE);
        const r = await addRepoThroughBus(ws, id, upstream, values.base);
        console.log(`repo ${ws}/${r.id} ok · upstream ${r.upstream_url} · base ${r.base_branch} · staging ready`);
        break;
      }
      case "repos": {
        if (!sub) throw new Error(USAGE);
        for (const r of await store.repos(sub)) console.log(`${r.id}  ${r.provider}  ${r.base_branch}  ${r.upstream_url}`);
        break;
      }
      case "send": {
        const [agent, ...text] = rest;
        const ws = sub;
        if (!ws || !agent || text.length === 0) throw new Error(USAGE);
        const body = text.join(" ");
        const t = await store.createThread({ workspaceId: ws, title: values.title ?? body.slice(0, 60), createdBy: HUMAN, assignee: agent, severity: values.severity ?? null, repoId: values.repo ?? null });
        await store.postMessage({ workspaceId: ws, threadId: t.id, type: "request", from: HUMAN, to: agent, body });
        console.log(`${t.id} opened for ${agent}`);
        break;
      }
      case "reply": {
        const threadId = sub;
        const t = threadId ? await store.thread(threadId) : null;
        if (!t || rest.length === 0) throw new Error(USAGE);
        const to = values.to ?? t.assignee;
        if (!to) throw new Error("provide --to");
        const m = await store.postMessage({
          workspaceId: t.workspace_id, threadId: t.id, type: (values.type ?? "answer") as never,
          from: HUMAN, to, body: rest.join(" "), replyTo: values.re ?? null,
        });
        console.log(`message ${m.id} sent to ${to}`);
        break;
      }
      case "threads": {
        if (!sub) throw new Error(USAGE);
        for (const t of await store.threads(sub, values.state)) console.log(`${t.id}  ${t.state.padEnd(22)} ${t.assignee ?? "-"}  ${t.title}`);
        break;
      }
      case "thread": {
        const t = sub ? await store.thread(sub) : null;
        if (!t) throw new Error("thread not found");
        console.log(`${t.id} "${t.title}" · ${t.state} · assignee ${t.assignee ?? "-"}\n`);
        for (const m of await store.messages(t.id)) {
          console.log(`#${m.id} ${m.created_at.toISOString().slice(11, 19)} ${m.type}${m.outcome ? "/" + m.outcome : ""} ${m.from_actor} → ${m.to_actor}`);
          console.log(`   ${m.body.replace(/\n/g, "\n   ")}`);
        }
        break;
      }
      case "runs": {
        if (!sub) throw new Error(USAGE);
        for (const r of await store.runs(sub)) {
          console.log(`run ${r.id} ${r.agent_id} ${r.thread_id} ${r.state} ${r.model}/${r.effort} · ${r.route_reason}${r.error ? " · error: " + r.error : ""}`);
        }
        break;
      }
      case "usage": {
        if (!sub) throw new Error(USAGE);
        console.log(await store.usage(sub) ?? "no reading yet");
        break;
      }
      default:
        throw new Error(USAGE);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});

/** Talks to the bus API as the user (admin token from ~/.forgehall). */
async function busApi<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const url = process.env.FORGEHALL_BUS_URL ?? "http://127.0.0.1:4545";
  const res = await fetch(url + path, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${await ensureAdminToken()}`, "content-type": "application/json" },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  }).catch(() => {
    throw new Error(`The bus is not reachable at ${url}. Start the stack: docker compose -f infra/docker/compose.yaml -p forgehall up -d --build`);
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `bus answered HTTP ${res.status}`);
  return data;
}

/**
 * Registers a repo through the bus, which owns the staging remotes. A local upstream must live
 * under ~/.forgehall (mounted into the bus container); its host path is translated for the bus.
 */
async function addRepoThroughBus(ws: string, id: string, upstream: string, base?: string) {
  const { home } = await busApi<{ home: string }>("/health");
  let target = upstream;
  const isUrl = /^[a-z]+:\/\//i.test(upstream) || /^[^/]+@[^:]+:/.test(upstream);
  if (!isUrl) {
    const abs = resolve(upstream);
    const local = forgehallHome();
    if (home !== local) {
      if (!abs.startsWith(local + "/")) throw new Error(`The bus runs in a container and cannot see ${abs}. Put local upstreams under ${join(local, "upstreams")} or use a git URL.`);
      target = join(home, abs.slice(local.length + 1));
    } else {
      target = abs;
    }
  }
  return busApi<{ id: string; upstream_url: string; base_branch: string }>(`/api/workspaces/${encodeURIComponent(ws)}/repos`, {
    method: "POST",
    body: { id, upstream: target, ...(base ? { base } : {}) },
  });
}

/** Creates ~/.forgehall (admin token, upstreams/) and the compose settings for this machine. */
async function setup() {
  const home = forgehallHome();
  await mkdir(join(home, "upstreams"), { recursive: true });
  await ensureAdminToken();
  const rootless = await dockerIsRootless();
  // Rootless Docker maps container root to you; with rootful Docker the stack runs as your user.
  const uid = rootless ? 0 : process.getuid?.() ?? 1000;
  const gid = rootless ? 0 : process.getgid?.() ?? 1000;
  const envFile = fileURLToPath(new URL("../../../infra/docker/.env", import.meta.url));
  await writeFile(envFile, `# Written by fh setup\nFORGEHALL_HOME_HOST=${home}\nFORGEHALL_UID=${uid}\nFORGEHALL_GID=${gid}\n`);
  console.log(`Data directory: ${home}\nDocker: ${rootless ? "rootless" : "rootful"} (stack runs as ${uid}:${gid})\nWrote ${envFile}\n
Next:
  docker compose -f infra/docker/compose.yaml -p forgehall up -d --build
  docker build -f infra/docker/Dockerfile --target runner -t forgehall/runner:dev .
  claude setup-token   # once; save it to ~/.config/forgehall/claude-token (chmod 600)`);
}
