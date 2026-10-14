import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../context";
import { api, HUMAN, type Message, type MessageType, type Run } from "../api";
import { useAgents, useThread } from "../queries";
import { Avatar, Chip, ErrorBox, Icon, ModelChip } from "../ui";
import { ago, clock, money, MONEY_HINT, runDuration, STATE_LABEL, STEPS, stateTone } from "../util";

const TYPE_ICON: Record<string, string> = { request: "task", ask: "dm", answer: "say", verify: "result", approval: "check", notify: "info", decision: "escalate" };
const TYPE_TONE: Record<string, string> = { ask: "sonnet", answer: "haiku", verify: "warn", approval: "warn", decision: "opus" };

type Item = { kind: "msg"; at: number; m: Message } | { kind: "run"; at: number; r: Run };

export function ThreadPage() {
  const { id } = useParams();
  const q = useThread(id);
  const agents = useAgents(useApp().workspace).data ?? [];
  const nameOf = (a: string) => (a === HUMAN ? "You" : agents.find((x) => x.id === a)?.name ?? a);

  const items = useMemo<Item[]>(() => {
    if (!q.data) return [];
    const out: Item[] = [
      ...q.data.messages.map((m) => ({ kind: "msg" as const, at: new Date(m.created_at).getTime(), m })),
      ...q.data.runs.map((r) => ({ kind: "run" as const, at: new Date(r.started_at ?? r.queued_at).getTime(), r })),
    ];
    return out.sort((a, b) => a.at - b.at);
  }, [q.data]);

  if (q.isLoading) return <div className="main-body"><p className="empty">Loading…</p></div>;
  if (q.error || !q.data) return <div className="main-body"><Link to="/threads" className="btn sm ghost">← Threads</Link><ErrorBox error={q.error ?? new Error("Thread not found")} /></div>;
  const { thread, messages, runs } = q.data;
  const stepIdx = thread.state === "external_review" ? 3 : STEPS.indexOf(thread.state);
  const people = [...new Set(messages.flatMap((m) => [m.from_actor, m.to_actor]))];
  const msgById = new Map(messages.map((m) => [m.id, m]));
  const finished = thread.state === "done";

  return (
    <>
      <div className="main-head th-head">
        <div className="title-row">
          <Link to="/threads" className="btn sm ghost">← Threads</Link>
        </div>
        <div className="title-row">
          <Chip><span className="mono">{thread.id}</span></Chip>
          <h1>{thread.title}</h1>
          <Chip tone={stateTone(thread.state)}>{STATE_LABEL[thread.state]}</Chip>
          {thread.severity && <Chip tone={thread.severity === "high" ? "err" : thread.severity === "medium" ? "warn" : ""}>{thread.severity}</Chip>}
          <div className="meta">assignee <span className="mono">{thread.assignee ?? "none"}</span> · updated {ago(thread.updated_at)}</div>
        </div>
        {stepIdx >= 0 ? (
          <ol className="stepper" style={{ ["--n" as string]: STEPS.length }} aria-label="Thread progress">
            {STEPS.map((s, i) => {
              const cls = i < stepIdx ? "done" : i === stepIdx ? `now ${s === "done" ? "fin" : ""}` : "";
              return <li key={s} className={cls}><span className="n">{i < stepIdx || (s === "done" && finished) ? <Icon n="check" /> : i + 1}</span><span className="l">{STATE_LABEL[s]}</span></li>;
            })}
          </ol>
        ) : <div className="pad-b" style={{ paddingBottom: 14 }}><span className="muted">State: {STATE_LABEL[thread.state]}</span></div>}
      </div>
      <div className="main-body">
        <div className="thread-grid">
          <div className="tl">
            {items.map((it) => it.kind === "run" ? <RunMark key={`r${it.r.id}`} r={it.r} /> : (
              <div key={`m${it.m.id}`} className="tl-item">
                <span className="ico"><Icon n={TYPE_ICON[it.m.type] ?? "say"} /></span>
                <div>
                  <div className="hd">
                    <Chip tone={TYPE_TONE[it.m.type]}>{it.m.type}</Chip>
                    <b>{nameOf(it.m.from_actor)}</b><span className="faint">→</span><b>{nameOf(it.m.to_actor)}</b>
                    {it.m.outcome && <Chip tone={it.m.outcome === "passed" ? "ok" : "err"}>{it.m.outcome}</Chip>}
                    <time>{clock(it.m.created_at)}</time>
                  </div>
                  {it.m.reply_to && <div className="reply-ref">↳ replies to #{it.m.reply_to}{msgById.get(it.m.reply_to) ? ` (${msgById.get(it.m.reply_to)!.type} from ${nameOf(msgById.get(it.m.reply_to)!.from_actor)})` : ""}</div>}
                  <div className="body"><pre>{it.m.body}</pre></div>
                </div>
              </div>
            ))}
            {items.length === 0 && <p className="empty">No messages yet.</p>}
          </div>

          <div className="side-cards">
            {thread.state === "awaiting_approval" && <ApprovalCard threadId={thread.id} assignee={thread.assignee} />}
            <div className="card">
              <h3>Runs <span className="mono">{runs.length}</span></h3>
              {runs.length === 0 ? <p className="empty">No runs yet.</p> : (
                <div className="kvl">{runs.map((r) => (
                  <div key={r.id}><span className="mono">#{r.id} {r.agent_id}</span><b><ModelChip model={r.model} /> <span className={r.state === "failed" ? "" : "muted"} style={r.state === "failed" ? { color: "var(--err)" } : undefined}>{r.state}</span></b></div>
                ))}</div>
              )}
            </div>
            <div className="card">
              <h3>Participants</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {people.map((p) => <div key={p} style={{ display: "flex", gap: 8, alignItems: "center" }}><Avatar id={p} name={nameOf(p)} />{p === HUMAN ? "You" : <Link to={`/agents/${p}`}>{nameOf(p)}</Link>}</div>)}
              </div>
            </div>
            <Composer threadId={thread.id} defaultTo={thread.assignee} lastMessageId={messages[messages.length - 1]?.id} />
          </div>
        </div>
      </div>
    </>
  );
}

function RunMark({ r }: { r: Run }) {
  const dur = runDuration(r);
  return (
    <div className="runmark">
      <span className="ico"><Icon n="run" /></span>
      <div className="txt">
        <span className="mono">Run #{r.id}</span><span>·</span><span className="mono">{r.agent_id}</span><ModelChip model={r.model} effort={r.effort} />
        {r.route_reason && <><span>·</span><span>{r.route_reason}</span></>}
        <span>·</span><Chip tone={r.state === "done" ? "ok" : r.state === "failed" ? "err" : r.state === "running" ? "warn" : ""}>{r.state}</Chip>
        {dur && <span className="mono">{dur}</span>}
        {r.cost_usd != null && <span className="mono" title={MONEY_HINT}>{money(r.cost_usd)}</span>}
        {r.error && <span style={{ color: "var(--err)" }}>{r.error}</span>}
      </div>
    </div>
  );
}

function useSend(threadId: string, onDone?: () => void) {
  const qc = useQueryClient();
  const app = useApp();
  return useMutation({
    mutationFn: (b: { to: string; type: MessageType; body: string; replyTo?: string }) => api.postMessage(threadId, b),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["thread", threadId] });
      void qc.invalidateQueries({ queryKey: ["threads"] });
      app.toast("Message sent");
      onDone?.();
    },
  });
}

function Composer({ threadId, defaultTo, lastMessageId }: { threadId: string; defaultTo: string | null; lastMessageId?: string }) {
  const agents = useAgents(useApp().workspace).data ?? [];
  const [to, setTo] = useState("");
  const [type, setType] = useState<MessageType>("answer");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState(false);
  const target = to || defaultTo || agents[0]?.id || "";
  const m = useSend(threadId, () => setBody(""));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target || !body.trim()) return;
    m.mutate({ to: target, type, body: body.trim(), ...(reply && lastMessageId ? { replyTo: lastMessageId } : {}) });
  };
  return (
    <form className="card decision" onSubmit={submit}>
      <h3>Message an agent</h3>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <select className="select" aria-label="To" value={target} onChange={(e) => setTo(e.target.value)}>{agents.map((a) => <option key={a.id} value={a.id}>to {a.name}</option>)}</select>
        <select className="select" aria-label="Type" value={type} onChange={(e) => setType(e.target.value as MessageType)}>{(["answer", "request", "decision", "notify"] as const).map((t) => <option key={t} value={t}>{t}</option>)}</select>
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message…" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e as unknown as FormEvent); }} />
      {lastMessageId && <label style={{ display: "flex", gap: 6, fontSize: 12, color: "var(--muted)", marginBottom: 8 }}><input type="checkbox" checked={reply} onChange={(e) => setReply(e.target.checked)} />Reply to the last message (#{lastMessageId})</label>}
      <ErrorBox error={m.error} />
      <div className="acts"><button className="btn primary" type="submit" disabled={!body.trim() || !target || m.isPending}>{m.isPending ? "Sending…" : "Send"}</button></div>
      <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Ctrl+Enter sends. Every message wakes the recipient with a new run.</div>
    </form>
  );
}

function ApprovalCard({ threadId, assignee }: { threadId: string; assignee: string | null }) {
  const [comment, setComment] = useState("");
  const [bad, setBad] = useState(false);
  const m = useSend(threadId, () => { setComment(""); setBad(false); });
  const to = assignee ?? "";
  return (
    <div className="card decision">
      <h3>Approval <Chip tone="warn">basic</Chip></h3>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 12.5 }}>Basic approval: sends a decision to the assignee. Full approval policies (merge, pull request, branch only) come in phase 2.</p>
      <textarea className={bad ? "bad" : ""} value={comment} onChange={(e) => { setComment(e.target.value); setBad(false); }} placeholder="Comment (required to request changes)" />
      {bad && <div className="errmsg">Explain what should change.</div>}
      <ErrorBox error={m.error} />
      <div className="acts">
        <button className="btn primary" disabled={!to || m.isPending} onClick={() => m.mutate({ to, type: "decision", body: comment.trim() ? `Approved. ${comment.trim()}` : "Approved." })}>Approve</button>
        <button className="btn" disabled={!to || m.isPending} onClick={() => { if (!comment.trim()) return setBad(true); m.mutate({ to, type: "decision", body: `Changes requested: ${comment.trim()}` }); }}>Request changes</button>
      </div>
    </div>
  );
}
