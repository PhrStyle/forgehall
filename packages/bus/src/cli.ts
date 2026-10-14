#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { HUMAN, Model } from "@forgehall/shared";
import { connect, migrate } from "./db.js";
import { Store } from "./store.js";

const USAGE = `fh — Forgehall operations (phase 1, no console yet)

  fh migrate
  fh workspace add <id> <name>
  fh agent add <ws> <id> --name <name> --role <role> [--model sonnet] [--prompt-file agent.md] [--accepts a,b]
  fh agent token <ws> <id>                 generates a new token (invalidates the previous one)
  fh send <ws> <agent> <text> [--title <title>] [--severity high]
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
        const [ws, id] = rest;
        if (!ws || !id) throw new Error(USAGE);
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
      case "send": {
        const [agent, ...text] = rest;
        const ws = sub;
        if (!ws || !agent || text.length === 0) throw new Error(USAGE);
        const body = text.join(" ");
        const t = await store.createThread({ workspaceId: ws, title: values.title ?? body.slice(0, 60), createdBy: HUMAN, assignee: agent, severity: values.severity ?? null });
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
