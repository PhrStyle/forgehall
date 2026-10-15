import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../context";
import { api, HUMAN, type Approval, type ApprovalResult, type Reviewer, type BranchDiff, type Message, type MessageType, type Run } from "../api";
import { ReviewerPicker } from "../components/ReviewerPicker";
import { Markdown } from "../components/Markdown";
import { NeedsYou, QuestionsHistory } from "../components/Questions";
import { PermissionList } from "../components/PermissionCard";
import { useAgents, useApprovals, useDiff, usePermissions, useSupervisor, useThread, useThreads } from "../queries";
import { Avatar, Chip, ErrorBox, Icon, ModelChip, WaitBadge } from "../ui";
import { OUTCOME_LABEL, SEND_TYPES, typeLabel } from "../labels";
import { ago, clock, money, MONEY_HINT, runDuration, STATE_LABEL, STEPS, stateTone } from "../util";
import "../styles/thread.css";

type Item = { kind: "msg"; at: number; m: Message } | { kind: "run"; at: number; r: Run };
type Tab = "conversation" | "changes" | "runs";

const RUN_TIP = "API-equivalent estimate; with a subscription you are not charged";
const modelName = (m: string | null | undefined) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : "");

export function ThreadPage() {
  const { id } = useParams();
  const q = useThread(id);
  const ws = useApp().workspace;
  const agents = useAgents(ws).data ?? [];
  const threadList = useThreads(ws).data ?? [];
  const perms = (usePermissions(ws).data ?? []).filter((x) => x.thread_id === id);
  const nameOf = (a: string) => (a === HUMAN ? "You" : agents.find((x) => x.id === a)?.name ?? a);
  const hasRepo = !!q.data?.thread.repo_id;
  const diffQ = useDiff(id, hasRepo);
  const approvalsQ = useApprovals(id, hasRepo);
  const [tab, setTab] = useState<Tab>("conversation");

  // Questions.tsx asks for the conversation before it scrolls to a message.
  useEffect(() => {
    const show = () => setTab("conversation");
    window.addEventListener("fh:show-conversation", show);
    return () => window.removeEventListener("fh:show-conversation", show);
  }, []);
  useEffect(() => { setTab("conversation"); }, [id]);

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
  const questions = q.data.questions ?? [];
  const openQs = questions.filter((x) => !x.answered_by);
  const qById = new Map(questions.map((x) => [x.message_id, x]));
  const row = threadList.find((x) => x.id === thread.id);
  const waitReason = openQs.length > 0 ? "question" : row?.waiting_reason ?? (perms.length > 0 ? "permission" : thread.state === "awaiting_approval" ? "approval" : null);
  const stepIdx = thread.state === "external_review" ? 3 : STEPS.indexOf(thread.state);
  const people = [...new Set(messages.flatMap((m) => [m.from_actor, m.to_actor]))].filter((p) => p !== "system");
  const msgById = new Map(messages.map((m) => [m.id, m]));
  const finished = thread.state === "done";
  const fileCount = diffQ.data?.files.length;
  const pr = (approvalsQ.data ?? []).find((a) => a.result?.pr)?.result?.pr;
  const tabs: { id: Tab; label: string; count?: string }[] = [
    { id: "conversation", label: "Conversation" },
    ...(hasRepo ? [{ id: "changes" as const, label: "Changes", count: fileCount != null ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : undefined }] : []),
    { id: "runs", label: "Runs", count: String(runs.length) },
  ];
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setTab(tabs[n]!.id);
    document.getElementById(`th-tab-${tabs[n]!.id}`)?.focus();
  };

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
          {waitReason && <WaitBadge reason={waitReason} />}
          {thread.repo_id && <Chip><span className="mono">{thread.repo_id}{thread.branch ? ` · ${thread.branch}` : ""}</span></Chip>}
          {thread.severity && <Chip tone={thread.severity === "high" ? "err" : thread.severity === "medium" ? "warn" : ""}>{thread.severity}</Chip>}
          <div className="meta">assignee <span className="mono">{thread.assignee ?? "none"}</span> · updated {ago(thread.updated_at)}</div>
          <ThreadActions threadId={thread.id} state={thread.state} canReopen={!!thread.assignee && thread.assignee !== HUMAN} />
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
        <OfflineRunnerBanner runs={runs} agents={agents} workspace={thread.workspace_id} />
        <div className="th-tabs" role="tablist" aria-label="Thread sections" onKeyDown={onTabKey}>
          {tabs.map((t) => (
            <button key={t.id} id={`th-tab-${t.id}`} type="button" role="tab" className="th-tab" aria-selected={tab === t.id} aria-controls={`th-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}>
              {t.label}{t.count && <span className="mono">· {t.count}</span>}
            </button>
          ))}
        </div>

        {tab === "changes" && hasRepo && (
          <div id="th-panel-changes" role="tabpanel" aria-labelledby="th-tab-changes" className="th-changes"><ChangesCard threadId={thread.id} /></div>
        )}
        {tab === "runs" && (
          <div id="th-panel-runs" role="tabpanel" aria-labelledby="th-tab-runs"><RunsTable runs={runs} nameOf={nameOf} /></div>
        )}
        {tab === "conversation" && (
          <div className="thread-grid" id="th-panel-conversation" role="tabpanel" aria-labelledby="th-tab-conversation">
            <div className="th-convo">
              <div className="tl">
                {items.map((it) => it.kind === "run" ? <RunLine key={`r${it.r.id}`} r={it.r} nameOf={nameOf} /> : (
                  <MessageItem key={`m${it.m.id}`} m={it.m} nameOf={nameOf} replied={it.m.reply_to ? msgById.get(it.m.reply_to) : undefined} answered={!!qById.get(it.m.id)?.answered_by} />
                ))}
                {items.length === 0 && <p className="empty">No messages yet.</p>}
              </div>
              <Composer key={thread.id} threadId={thread.id} defaultTo={thread.assignee} messages={messages} />
            </div>

            <aside className="th-side" aria-label="Thread status">
              <div className="side-cards">
                <NeedsYou threadId={thread.id} questions={questions} nameOf={nameOf} />
                <PermissionList items={perms} />
                {hasRepo ? <RepoApprovalCard threadId={thread.id} title={thread.title} /> : thread.state === "awaiting_approval" && <ApprovalCard threadId={thread.id} assignee={thread.assignee} />}
                {pr && (
                  <div className="card pr-card">
                    <h3>Pull request</h3>
                    <div className="pr-link"><a href={pr.url} target="_blank" rel="noreferrer noopener">Pull request #{pr.id}</a><Chip tone={PR_TONE[pr.status]}>{pr.status}</Chip></div>
                  </div>
                )}
                {hasRepo && <BranchCard threadId={thread.id} />}
                <div className="card">
                  <h3>Participants</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {people.map((p) => <div key={p} style={{ display: "flex", gap: 8, alignItems: "center" }}><Avatar id={p} name={nameOf(p)} />{p === HUMAN ? "You" : <Link to={`/agents/${p}`}>{nameOf(p)}</Link>}</div>)}
                  </div>
                </div>
                <QuestionsHistory questions={questions} nameOf={nameOf} />
              </div>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}

function MessageItem({ m, nameOf, replied, answered }: { m: Message; nameOf: (a: string) => string; replied?: Message; answered: boolean }) {
  const t = typeLabel(m.type);
  const toYou = m.type === "ask" && m.to_actor === HUMAN;
  const system = m.from_actor === "system";
  return (
    <div id={`msg-${m.id}`} className={`tl-item ${toYou ? "to-you" : ""} ${system ? "sys" : ""}`}>
      <span className="ico" title={m.type}><Icon n={system ? "info" : t.icon} /></span>
      <div>
        <div className="hd">
          <span title={`Message type: ${m.type}`}><Chip tone={t.tone}><span className="type-chip"><Icon n={t.icon} />{t.label}</span></Chip></span>
          {toYou && <span className="at-you">@you</span>}
          <b>{nameOf(m.from_actor)}</b><span className="faint">→</span><b>{nameOf(m.to_actor)}</b>
          {m.outcome && <Chip tone={m.outcome === "passed" ? "ok" : "err"}>{OUTCOME_LABEL[m.outcome] ?? m.outcome}</Chip>}
          <time>{clock(m.created_at)}</time>
        </div>
        {m.reply_to && <div className="reply-ref">↳ replies to #{m.reply_to}{replied ? ` (${typeLabel(replied.type).label.toLowerCase()} from ${nameOf(replied.from_actor)})` : ""}</div>}
        <Markdown text={m.body} compact={system} />
        {m.options && m.options.length > 0 && (
          <div className="opt-chips" aria-label="Options offered">{m.options.map((o) => <span key={o} className="opt-chip">{o}</span>)}</div>
        )}
        {toYou && answered && <div className="reply-ref">Answered</div>}
      </div>
    </div>
  );
}

function RunLine({ r, nameOf }: { r: Run; nameOf: (a: string) => string }) {
  const dur = runDuration(r);
  const verb = r.state === "queued" ? "queued" : r.state === "running" ? "is working" : r.state === "failed" ? "failed" : "worked";
  const summary = `${nameOf(r.agent_id)} ${verb}${dur ? ` ${dur}` : ""} · ${modelName(r.model)}`;
  return (
    <details className={`runline ${r.state}`}>
      <summary title={`Run #${r.id} · ${r.effort} effort${r.route_reason ? ` · ${r.route_reason}` : ""}${r.cost_usd != null ? ` · ${money(r.cost_usd)}` : ""}`}>{summary}</summary>
      <div className="rl-det">
        <span className="mono">Run #{r.id}</span>
        <ModelChip model={r.model} effort={r.effort} />
        {r.route_reason && <span>why: {r.route_reason}</span>}
        <span>{r.state}</span>
        {r.cost_usd != null && <span className="mono" title={RUN_TIP}>{money(r.cost_usd)}</span>}
        {r.error && <span className="err">{r.error}</span>}
      </div>
    </details>
  );
}

function RunsTable({ runs, nameOf }: { runs: Run[]; nameOf: (a: string) => string }) {
  if (runs.length === 0) return <p className="empty">No runs yet.</p>;
  return (
    <div className="runs-wrap">
      <table className="runs-table">
        <thead><tr><th scope="col">#</th><th scope="col">Agent</th><th scope="col">Model / effort</th><th scope="col">Why</th><th scope="col">State</th><th scope="col" className="num">Duration</th><th scope="col" className="num">Cost</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.id}</td>
              <td>{nameOf(r.agent_id)}</td>
              <td><ModelChip model={r.model} effort={r.effort} /></td>
              <td className="muted">{r.route_reason ?? "—"}</td>
              <td><Chip tone={r.state === "done" ? "ok" : r.state === "failed" ? "err" : r.state === "running" ? "warn" : ""}>{r.state}</Chip>{r.error && <div className="err">{r.error}</div>}</td>
              <td className="num mono">{runDuration(r) || "—"}</td>
              <td className="num mono">{r.cost_usd != null ? <span title={RUN_TIP}>{money(r.cost_usd)}</span> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

function Composer({ threadId, defaultTo, messages }: { threadId: string; defaultTo: string | null; messages: Message[] }) {
  const agents = useAgents(useApp().workspace).data ?? [];
  const [to, setTo] = useState("");
  const [typeOverride, setTypeOverride] = useState<MessageType | null>(null);
  const [body, setBody] = useState("");
  const target = to || (defaultTo && defaultTo !== HUMAN ? defaultTo : "") || agents[0]?.id || "";
  const targetName = agents.find((a) => a.id === target)?.name ?? "the agent";
  // Replying: the last message of the thread came from this agent. Otherwise it is a new task.
  const last = messages[messages.length - 1];
  const replying = !!last && last.from_actor === target && last.to_actor === HUMAN;
  const type: MessageType = typeOverride ?? (replying ? "answer" : "request");
  const ref = useRef<HTMLTextAreaElement>(null);
  const m = useSend(threadId, () => { setBody(""); setTypeOverride(null); });
  const send = () => {
    if (!target || !body.trim() || m.isPending) return;
    m.mutate({ to: target, type, body: body.trim(), ...(type === "answer" && replying && last ? { replyTo: last.id } : {}) });
  };
  const submit = (e: FormEvent) => { e.preventDefault(); send(); };
  return (
    <div className="composer">
      <form onSubmit={submit} aria-label="Message an agent">
        <div className="cp-row">
          <label htmlFor="cp-to">To:</label>
          <select id="cp-to" className="select" value={target} onChange={(e) => setTo(e.target.value)}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </div>
        <textarea ref={ref} value={body} aria-label={`Message to ${targetName}`} onChange={(e) => setBody(e.target.value)} placeholder={`Write to ${targetName}…`} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
        <ErrorBox error={m.error} />
        <div className="cp-foot">
          <details className="cp-type">
            <summary>Message type{typeOverride ? `: ${SEND_TYPES.find((s) => s.type === typeOverride)?.label}` : ""}</summary>
            <div className="seg" role="radiogroup" aria-label="Message type">
              {SEND_TYPES.map((s) => (
                <label key={s.type} title={s.hint}><input type="radio" name="cp-type" checked={type === s.type} onChange={() => setTypeOverride(s.type)} />{s.label}</label>
              ))}
            </div>
          </details>
          <span className="grow faint" style={{ fontSize: 11.5 }}>Ctrl/⌘+Enter to send. Wakes {targetName} with a new run.</span>
          <button className="btn primary" type="submit" disabled={!body.trim() || !target || m.isPending}>{m.isPending ? "Sending…" : "Send"}</button>
        </div>
      </form>
    </div>
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

/** Close (done / cancelled) or reopen a thread. Cancelling and reopening ask for one more step. */
function ThreadActions({ threadId, state, canReopen }: { threadId: string; state: string; canReopen: boolean }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const [mode, setMode] = useState<"idle" | "cancel" | "reopen">("idle");
  const [note, setNote] = useState("");
  const done = () => { setMode("idle"); setNote(""); void qc.invalidateQueries(); };
  const close = useMutation({
    mutationFn: (s: "done" | "cancelled") => api.closeThread(threadId, { state: s, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (_d, s) => { toast(s === "done" ? "Thread marked done" : "Thread cancelled"); done(); },
  });
  const reopen = useMutation({
    mutationFn: () => api.reopenThread(threadId, note.trim()),
    onSuccess: () => { toast("Thread reopened"); done(); },
  });
  const closed = state === "done" || state === "cancelled";
  const reopenable = closed || state === "blocked";
  const err = close.error ?? reopen.error;

  if (mode === "cancel") return (
    <div className="actions th-actions">
      <input className="input sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" aria-label="Reason for cancelling" />
      <button className="btn sm" onClick={() => setMode("idle")}>Keep</button>
      <button className="btn sm danger" disabled={close.isPending} onClick={() => close.mutate("cancelled")}>Cancel thread</button>
      {err && <ErrorBox error={err} />}
    </div>
  );
  if (mode === "reopen") return (
    <div className="actions th-actions">
      <input className="input sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should happen now?" aria-label="Instructions for the assignee" autoFocus />
      <button className="btn sm" onClick={() => setMode("idle")}>Back</button>
      <button className="btn sm primary" disabled={!note.trim() || reopen.isPending} onClick={() => reopen.mutate()}>Reopen</button>
      {err && <ErrorBox error={err} />}
    </div>
  );
  return (
    <div className="actions th-actions">
      {!closed && <button className="btn sm" disabled={close.isPending} onClick={() => close.mutate("done")}>Mark done</button>}
      {!closed && <button className="btn sm ghost" onClick={() => setMode("cancel")}>Cancel…</button>}
      {reopenable && canReopen && <button className="btn sm" onClick={() => setMode("reopen")}>Reopen…</button>}
      {err && <ErrorBox error={err} />}
    </div>
  );
}

const short = (sha: string | null | undefined) => (sha ?? "").slice(0, 7);

function BranchCard({ threadId }: { threadId: string }) {
  const q = useDiff(threadId, true);
  const d = q.data;
  const add = d?.files.reduce((n, f) => n + f.additions, 0) ?? 0;
  const del = d?.files.reduce((n, f) => n + f.deletions, 0) ?? 0;
  return (
    <div className="card">
      <h3>Branch</h3>
      {q.isLoading && <p className="empty">Loading…</p>}
      <ErrorBox error={q.error} />
      {d && (
        <>
          <div className="branch-chips"><Chip><span className="mono">{d.branch}</span></Chip><span className="faint">→</span><Chip><span className="mono">{d.base}</span></Chip></div>
          <div className="kvl" style={{ marginTop: 10 }}>
            <div><span>Commits</span><b>{d.commits.length}</b></div>
            <div><span>Files changed</span><b>{d.files.length} <span className="df-add">+{add}</span> <span className="df-del">−{del}</span></b></div>
          </div>
          {d.commits.length === 0 ? <p className="empty">No commits on this branch yet.</p> : (
            <ul className="commits">
              {d.commits.map((c) => (
                <li key={c.sha}>
                  <span className="mono sha">{short(c.sha)}</span>
                  <span className="subj">{c.subject}<small>{c.author} · {ago(c.date)}</small></span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

interface FileDiff { path: string; lines: string[]; additions: number; deletions: number }

function splitPatch(patch: string): FileDiff[] {
  if (!patch) return [];
  return patch.split(/^(?=diff --git )/m).filter((b) => b.startsWith("diff --git ")).map((block) => {
    const lines = block.replace(/\n$/, "").split("\n");
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(lines[0] ?? "");
    let additions = 0, deletions = 0, inHunk = false;
    for (const l of lines) {
      if (l.startsWith("@@")) inHunk = true;
      else if (inHunk && l.startsWith("+")) additions++;
      else if (inHunk && l.startsWith("-")) deletions++;
    }
    return { path: m?.[2] ?? lines[0] ?? "", lines, additions, deletions };
  });
}

function lineClass(l: string): string {
  if (l.startsWith("@@")) return "hunk";
  if (l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("new file") || l.startsWith("deleted file") || l.startsWith("similarity") || l.startsWith("rename ") || l.startsWith("Binary")) return "meta";
  if (l.startsWith("+")) return "add";
  if (l.startsWith("-")) return "del";
  return "";
}

function FileBlock({ f, open }: { f: FileDiff; open: boolean }) {
  return (
    <details className="dfile" open={open}>
      <summary><span className="mono path">{f.path}</span><span className="df-add">+{f.additions}</span><span className="df-del">−{f.deletions}</span></summary>
      <pre className="dpatch">{f.lines.map((l, i) => <span key={i} className={`dl ${lineClass(l)}`}>{l || " "}{"\n"}</span>)}</pre>
    </details>
  );
}

function ChangesCard({ threadId }: { threadId: string }) {
  const q = useDiff(threadId, true);
  const files = useMemo(() => splitPatch(q.data?.patch ?? ""), [q.data?.patch]);
  if (q.isLoading) return null;
  if (q.error) return <div className="card changes"><h3>Changes</h3><ErrorBox error={q.error} /></div>;
  const d = q.data as BranchDiff;
  return (
    <div className="card changes">
      <h3>Changes <span className="mono">{d.files.length} file{d.files.length === 1 ? "" : "s"}</span></h3>
      {files.length === 0 ? <p className="empty">No changes against {d.base} yet.</p> : files.map((f) => <FileBlock key={f.path} f={f} open={files.length <= 3} />)}
      {d.truncated && <div className="errbox" style={{ marginTop: 8, marginBottom: 0 }}>This diff is too large and was truncated. Review the rest in the repository.</div>}
    </div>
  );
}

const APPROVAL_TONE: Record<Approval["state"], string> = { pending: "warn", approved: "ok", rejected: "err", superseded: "" };

function policyLabel(policy: string, base?: string): string {
  if (policy === "merge") return `merge into ${base ?? "base"}`;
  return policy.replace(/_/g, " ");
}

const PR_TONE = { open: "warn", merged: "ok", closed: "err" } as const;

function ApprovalResultView({ result, base }: { result: ApprovalResult | null; base?: string }) {
  if (!result) return null;
  const { merged, commit, branch, warnings } = result;
  return (
    <>
      {merged && <p className="ap-result">Merged into {base ?? "base"} as <span className="mono">{short(merged)}</span></p>}
      {!merged && branch && <p className="ap-result">Pushed branch <span className="mono">{branch}</span>{commit && <> at <span className="mono">{short(commit)}</span></>}</p>}
      {warnings && warnings.length > 0 && <div className="warnbox" role="status"><ul style={{ margin: 0, paddingLeft: 16 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
    </>
  );
}

function RepoApprovalCard({ threadId, title }: { threadId: string; title: string }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const ap = useApprovals(threadId, true);
  const diff = useDiff(threadId, true);
  const [comment, setComment] = useState("");
  const [bad, setBad] = useState(false);
  const [prTitle, setPrTitle] = useState<string | null>(null);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const decide = useMutation({
    mutationFn: (b: { id: string; decision: "approve" | "reject"; comment?: string; reviewers?: string[]; title?: string }) =>
      api.decide(b.id, { decision: b.decision, ...(b.comment ? { comment: b.comment } : {}), ...(b.reviewers ? { reviewers: b.reviewers } : {}), ...(b.title ? { title: b.title } : {}) }),
    onSuccess: (_a, b) => { toast(b.decision === "approve" ? "Approved" : "Changes requested"); setComment(""); setBad(false); setReviewers([]); setPrTitle(null); },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["thread", threadId] }),
  });
  const list = ap.data ?? [];
  const [latest, ...older] = list;
  if (ap.isLoading) return null;
  if (ap.error) return <div className="card decision"><h3>Approval</h3><ErrorBox error={ap.error} /></div>;
  if (!latest) return null;
  const base = diff.data?.base;
  const pending = latest.state === "pending";
  const pinning = pending && !latest.head_sha;
  const isPr = latest.policy === "pull_request";
  const approveLabel = isPr ? "Approve and open pull request" : latest.policy === "branch_only" ? "Approve and push branch" : "Approve and merge";
  const effTitle = prTitle ?? title;
  const moved = pending && !!latest.head_sha && !!diff.data?.headSha && diff.data.headSha !== latest.head_sha;

  return (
    <div className="card decision">
      <h3>Approval <Chip tone={APPROVAL_TONE[latest.state]}>{latest.state}</Chip></h3>
      <div style={{ marginBottom: 8 }}><Chip tone="warn">{policyLabel(latest.policy, base)}</Chip></div>
      <div className="ap-summary"><Markdown text={latest.summary} compact /></div>
      <div className="kvl" style={{ marginBottom: 10 }}>
        <div><span>Requested by</span><b className="mono">{latest.requested_by}</b></div>
        <div><span>Pinned commit</span><b className="mono">{latest.head_sha ? short(latest.head_sha) : <span className="faint">pinning when the run ends…</span>}</b></div>
      </div>
      {moved && <div className="warnbox">The branch has new commits since approval was requested ({short(latest.head_sha)} → {short(diff.data?.headSha)}). Approving will be refused; ask the agent to request approval again.</div>}
      {pending && (
        <>
          {isPr && (
            <>
              <label className="field" style={{ marginBottom: 10 }}>Title
                <input value={effTitle} maxLength={200} onChange={(e) => setPrTitle(e.target.value)} />
              </label>
              <ReviewerPicker threadId={threadId} selected={reviewers} onChange={setReviewers} />
            </>
          )}
          <textarea className={bad ? "bad" : ""} value={comment} onChange={(e) => { setComment(e.target.value); setBad(false); }} placeholder="Comment (required to request changes)" />
          {bad && <div className="errmsg">Say what should change.</div>}
          <ErrorBox error={decide.error} />
          <div className="acts">
            <button className="btn primary" disabled={pinning || decide.isPending} title={pinning ? "Waiting for the agent's run to end" : undefined} onClick={() => decide.mutate({ id: latest.id, decision: "approve", ...(comment.trim() ? { comment: comment.trim() } : {}), ...(isPr ? { reviewers: reviewers.map((r) => r.id), ...(effTitle.trim() ? { title: effTitle.trim() } : {}) } : {}) })}>{decide.isPending ? "Working…" : approveLabel}</button>
            <button className="btn" disabled={decide.isPending} onClick={() => { if (!comment.trim()) return setBad(true); decide.mutate({ id: latest.id, decision: "reject", comment: comment.trim() }); }}>Request changes</button>
          </div>
        </>
      )}
      {latest.state === "approved" && <><p className="ap-result">Approved.{latest.comment ? <span className="muted"> · {latest.comment}</span> : null}</p><ApprovalResultView result={latest.result} base={base} /></>}
      {latest.state === "rejected" && <p className="ap-result">Changes requested{latest.comment ? <>: <span className="muted">{latest.comment}</span></> : ""}</p>}
      {latest.state === "superseded" && <p className="ap-result muted">Superseded{latest.comment ? `: ${latest.comment}` : ""}</p>}
      {older.length > 0 && (
        <details className="ap-hist">
          <summary>History ({older.length})</summary>
          <ul>{older.map((a) => (
            <li key={a.id}><Chip tone={APPROVAL_TONE[a.state]}>{a.state}</Chip><span className="mono">{short(a.head_sha) || "—"}</span><span className="faint">{ago(a.decided_at ?? a.created_at)}</span>{a.comment && <span className="muted subj">{a.comment}</span>}</li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}

/** Queued work for an agent whose runner is not connected will wait forever; say so and how to fix it. */
function OfflineRunnerBanner({ runs, agents, workspace }: { runs: Run[]; agents: { id: string; name: string; runner_online: boolean | null }[]; workspace: string }) {
  const waiting = [...new Set(runs.filter((r) => r.state === "queued").map((r) => r.agent_id))];
  const sup = useSupervisor().data?.online === true;
  const offline = waiting.map((id) => agents.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a && !a.runner_online);
  if (offline.length === 0) return null;
  if (sup) return <div className="banner warn" role="status"><span>{offline.map((a) => a.name).join(" and ")} {offline.length > 1 ? "have" : "has"} work queued. Starting… the supervisor starts it in a few seconds.</span></div>;
  return (
    <div className="banner warn" role="status">
      <b>{offline.map((a) => a.name).join(" and ")} {offline.length > 1 ? "have" : "has"} work queued but no runner connected.</b>
      <span> Nothing happens until a runner starts. In the repository folder (<code>fh agent run &lt;ws&gt; &lt;agent&gt;</code> works too):</span>
      {offline.map((a) => (
        <code key={a.id} className="term">node packages/bus/dist/cli.js agent run {workspace} {a.id}</code>
      ))}
    </div>
  );
}
