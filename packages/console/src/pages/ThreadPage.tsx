import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../context";
import { api, HUMAN, type Approval, type ApprovalResult, type Reviewer, type BranchDiff, type Message, type MessageType, type Run } from "../api";
import { ReviewerPicker } from "../components/ReviewerPicker";
import { PermissionList } from "../components/PermissionCard";
import { useAgents, useApprovals, useDiff, usePermissions, useSupervisor, useThread } from "../queries";
import { Avatar, Chip, ErrorBox, Icon, ModelChip } from "../ui";
import { ago, clock, money, MONEY_HINT, runDuration, STATE_LABEL, STEPS, stateTone } from "../util";

const TYPE_ICON: Record<string, string> = { request: "task", ask: "dm", answer: "say", verify: "result", approval: "check", notify: "info", decision: "escalate", complete: "check" };
const TYPE_TONE: Record<string, string> = { ask: "sonnet", answer: "haiku", verify: "warn", approval: "warn", decision: "opus", complete: "ok" };

type Item = { kind: "msg"; at: number; m: Message } | { kind: "run"; at: number; r: Run };

export function ThreadPage() {
  const { id } = useParams();
  const q = useThread(id);
  const ws = useApp().workspace;
  const agents = useAgents(ws).data ?? [];
  const perms = (usePermissions(ws).data ?? []).filter((x) => x.thread_id === id);
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
  const hasRepo = !!thread.repo_id;

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
        <div className="thread-grid">
          <div className="main-col">
          <PermissionList items={perms} />
          {hasRepo && <ChangesCard threadId={thread.id} />}
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
          </div>

          <div className="side-cards">
            {hasRepo && <BranchCard threadId={thread.id} />}
            {hasRepo ? <RepoApprovalCard threadId={thread.id} title={thread.title} /> : thread.state === "awaiting_approval" && <ApprovalCard threadId={thread.id} assignee={thread.assignee} />}
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
  const { merged, commit, branch, pr, warnings } = result;
  return (
    <>
      {merged && <p className="ap-result">Merged into {base ?? "base"} as <span className="mono">{short(merged)}</span></p>}
      {!merged && branch && <p className="ap-result">Pushed branch <span className="mono">{branch}</span>{commit && <> at <span className="mono">{short(commit)}</span></>}</p>}
      {pr && <p className="ap-result"><a href={pr.url} target="_blank" rel="noreferrer">Pull request #{pr.id}</a> <Chip tone={PR_TONE[pr.status]}>{pr.status}</Chip></p>}
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
      <p className="ap-summary">{latest.summary}</p>
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
