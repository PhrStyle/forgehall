import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, HUMAN, type HistoryEntry, type LearningProposal } from "../api";
import { useApp } from "../context";
import { useAgentLearning, useAgentMemory, useAgents, useKnowledge, useLearningProposals } from "../queries";
import { Avatar, Chip, ErrorBox } from "../ui";
import { ago, clock } from "../util";
import { Markdown } from "./Markdown";
import "../styles/learning.css";

const NAME = /^[a-z0-9][a-z0-9-]*$/;
const KB32 = 32 * 1024;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Splits YAML frontmatter from a SKILL.md. */
export function splitFrontmatter(text: string): { name: string | null; description: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { name: null, description: null, body: text };
  const get = (k: string) => {
    const l = new RegExp(`^${k}:\\s*(.*)$`, "m").exec(m[1]!);
    return l ? l[1]!.trim().replace(/^(["'])(.*)\1$/, "$2") || null : null;
  };
  return { name: get("name"), description: get("description"), body: text.slice(m[0].length) };
}

const memName = (path: string) => path.replace(/^memory\//, "").replace(/\.md$/, "");

function useInvalidate() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["learning"] });
}

function Confirm({ text, label, pending, onYes, onNo }: { text: string; label: string; pending: boolean; onYes: () => void; onNo: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="ln-confirm" role="alertdialog" aria-label={text}>
      <span>{text}</span>
      <button ref={ref} className="btn sm danger" disabled={pending} onClick={onYes}>{label}</button>
      <button className="btn sm ghost" onClick={onNo}>Cancel</button>
    </div>
  );
}

function agentLabel(id: string, names: Map<string, string>) { return id === HUMAN ? "You" : names.get(id) ?? id; }
function useNames() {
  const app = useApp();
  const agents = useAgents(app.workspace).data ?? [];
  return useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);
}

// ---------- Proposals ----------

const ACTION: Record<LearningProposal["action"], string> = { remember: "remember", forget: "forget", save_skill: "save the skill", remove_skill: "remove the skill" };

function ProposalCard({ p, showAgent }: { p: LearningProposal; showAgent: boolean }) {
  const inv = useInvalidate();
  const names = useNames();
  const [comment, setComment] = useState("");
  const m = useMutation({ mutationFn: (d: "approve" | "reject") => api.decideProposal(p.id, { decision: d, ...(comment.trim() ? { comment: comment.trim() } : {}) }), onSuccess: inv });
  const text = p.content ? (p.action === "save_skill" ? splitFrontmatter(p.content).body : p.content) : "";
  const who = agentLabel(p.agent_id, names);
  return (
    <div className="ln-card ln-prop">
      <div className="ln-head">
        <div className="nm">{showAgent && <Avatar id={p.agent_id} name={who} />}<span>{showAgent ? `${who} ` : "Wants to "}{showAgent ? "wants to " : ""}{ACTION[p.action]} <span className="mono">{p.name}</span></span></div>
        <span className="ln-sub" title={clock(p.created_at)}>{ago(p.created_at)}</span>
      </div>
      {text && <div className="ln-body"><Markdown text={text} compact /></div>}
      {p.reason && <div className="ln-reason">Why: {p.reason}</div>}
      {p.thread_id && <div className="ln-sub" style={{ marginTop: 4 }}>From <Link to={`/threads/${p.thread_id}`} className="mono">{p.thread_id}</Link></div>}
      <div className="ln-confirm">
        <input className="input sm" style={{ flex: 1, minWidth: 180 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" aria-label={`Comment on the proposal to ${ACTION[p.action]} ${p.name}`} />
        <button className="btn sm primary" disabled={m.isPending} onClick={() => m.mutate("approve")}>Approve</button>
        <button className="btn sm" disabled={m.isPending} onClick={() => m.mutate("reject")}>Reject</button>
      </div>
      <ErrorBox error={m.error} />
    </div>
  );
}

/** Pending learning proposals, optionally of one agent. */
export function ProposalList({ agent, title }: { agent?: string; title?: string }) {
  const app = useApp();
  const q = useLearningProposals(app.workspace);
  const rows = (q.data ?? []).filter((p) => !agent || p.agent_id === agent);
  if (rows.length === 0) return <ErrorBox error={q.error} />;
  return (
    <>
      <div className="section-title"><span>{title ?? "Learning proposals"}</span><span className="faint mono">{rows.length}</span></div>
      <ErrorBox error={q.error} />
      {rows.map((p) => <ProposalCard key={p.id} p={p} showAgent={!agent} />)}
    </>
  );
}

// ---------- Memory ----------

function MemoryCard({ ws, agent, name, content, changed }: { ws: string; agent: string; name: string; content: string; changed?: string }) {
  const inv = useInvalidate();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [draft, setDraft] = useState(content);
  const save = useMutation({ mutationFn: () => api.saveMemory(ws, agent, name, { content: draft }), onSuccess: () => { setMode("view"); inv(); } });
  const del = useMutation({ mutationFn: () => api.deleteMemory(ws, agent, name), onSuccess: () => { setMode("view"); inv(); } });
  return (
    <div className="ln-card">
      <div className="ln-head">
        <div className="nm"><span className="mono">{name}</span>{changed && <span className="ln-sub" title={clock(changed)}>changed {ago(changed)}</span>}</div>
        {mode === "view" && <div className="acts">
          <button className="btn sm" aria-label={`Edit memory ${name}`} onClick={() => { setDraft(content); setMode("edit"); }}>Edit</button>
          <button className="btn sm danger" aria-label={`Delete memory ${name}`} onClick={() => setMode("delete")}>Delete</button>
        </div>}
      </div>
      {mode === "edit" ? (
        <form className="ln-body" onSubmit={(e) => { e.preventDefault(); if (draft.trim() && draft !== content) save.mutate(); }}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Content of ${name}`} autoFocus maxLength={KB32} />
          <div className="ln-confirm"><button className="btn sm primary" type="submit" disabled={!draft.trim() || draft === content || save.isPending}>{save.isPending ? "Saving…" : "Save"}</button><button type="button" className="btn sm ghost" onClick={() => { setMode("view"); save.reset(); }}>Cancel</button></div>
          <ErrorBox error={save.error} />
        </form>
      ) : <div className="ln-body"><Markdown text={content} compact /></div>}
      {mode === "delete" && <Confirm text={`Delete the memory “${name}”? You can undo it in History.`} label="Delete" pending={del.isPending} onYes={() => del.mutate()} onNo={() => { setMode("view"); del.reset(); }} />}
      <ErrorBox error={del.error} />
    </div>
  );
}

function AddMemory({ ws, agent, existing }: { ws: string; agent: string; existing: Set<string> }) {
  const inv = useInvalidate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const bad = !NAME.test(name) ? "Use lowercase letters, digits and dashes, starting with a letter or digit." : existing.has(name) ? "A memory with this name exists: edit it instead." : null;
  const m = useMutation({ mutationFn: () => api.saveMemory(ws, agent, name, { content }), onSuccess: () => { setOpen(false); setName(""); setContent(""); inv(); } });
  if (!open) return <div style={{ marginTop: 12 }}><button className="btn sm" onClick={() => setOpen(true)}>Add memory</button></div>;
  return (
    <form className="ln-form" aria-label="Add memory" onSubmit={(e) => { e.preventDefault(); if (!bad && content.trim()) m.mutate(); }}>
      <label className="field">Name<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="coupon-seed" autoFocus aria-invalid={!!name && !!bad} />{name && bad && <span className="field-err" role="alert">{bad}</span>}</label>
      <label className="field">What should it remember?<textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={KB32} placeholder="Write it as a note to the agent, in Markdown." /></label>
      <ErrorBox error={m.error} />
      <div className="ln-confirm"><button className="btn sm primary" type="submit" disabled={!!bad || !content.trim() || m.isPending}>{m.isPending ? "Saving…" : "Save memory"}</button><button type="button" className="btn sm ghost" onClick={() => { setOpen(false); m.reset(); }}>Cancel</button></div>
    </form>
  );
}

export function MemoryTab({ agentId }: { agentId: string }) {
  const app = useApp();
  const ws = app.workspace!;
  const q = useAgentMemory(ws, agentId);
  const hist = useAgentLearning(ws, agentId).data ?? [];
  const names = useNames();
  const name = names.get(agentId) ?? agentId;
  const items = q.data?.memory ?? [];
  const lastChange = (n: string) => hist.find((h) => h.files.some((f) => f.path === `memory/${n}.md`))?.at;
  return (
    <div className="main-body">
      <ProposalList agent={agentId} title="Waiting for your approval" />
      <ErrorBox error={q.error} />
      {q.isLoading && <p className="empty">Loading…</p>}
      {q.isSuccess && items.length === 0 && (
        <div className="empty-state"><h3>No memory yet</h3><p>{name} has no memory yet. It learns when you correct it, answer its questions, or when a thread needed several rounds — or add something yourself.</p></div>
      )}
      {items.length > 0 && <div className="section-title"><span>Memory</span><span className="faint mono">{items.length}</span></div>}
      {items.map((f) => { const n = memName(f.path); return <MemoryCard key={n} ws={ws} agent={agentId} name={n} content={f.content} changed={lastChange(n)} />; })}
      {q.isSuccess && <AddMemory ws={ws} agent={agentId} existing={new Set(items.map((f) => memName(f.path)))} />}
    </div>
  );
}

// ---------- Skills ----------

export function SkillsTab({ agentId }: { agentId: string }) {
  const app = useApp();
  const ws = app.workspace!;
  const inv = useInvalidate();
  const q = useAgentMemory(ws, agentId);
  const names = useNames();
  const [confirm, setConfirm] = useState<string | null>(null);
  const del = useMutation({ mutationFn: (n: string) => api.deleteSkill(ws, agentId, n), onSuccess: () => { setConfirm(null); inv(); } });
  const skills = q.data?.skills ?? [];
  return (
    <div className="main-body">
      <ErrorBox error={q.error} />
      {q.isLoading && <p className="empty">Loading…</p>}
      {q.isSuccess && skills.length === 0 && (
        <div className="empty-state"><h3>No skills yet</h3><p>Skills are procedures {names.get(agentId) ?? agentId} writes down to reuse, such as how to prepare release notes. It saves one when a task needed a method worth repeating.</p></div>
      )}
      {skills.length > 0 && <div className="section-title"><span>Skills</span><span className="faint mono">{skills.length}</span></div>}
      {skills.map((s) => {
        const main = s.files[0];
        const fm = main ? splitFrontmatter(main.content) : null;
        return (
          <details key={s.name} className="ln-card">
            <summary style={{ cursor: "pointer" }}>
              <span className="nm"><b className="mono">{s.name}</b> <span className="ln-sub">{s.files.length} file{s.files.length === 1 ? "" : "s"}</span></span>
              {fm?.description && <div className="ln-reason">{fm.description}</div>}
            </summary>
            <div className="ln-body">
              {s.files.map((f, i) => (
                <div key={f.path} className="ln-file">
                  <h4 className="mono">{f.path.replace(/^skills\/[^/]+\//, "")}</h4>
                  {i === 0 ? <Markdown text={splitFrontmatter(f.content).body} compact /> : <pre className="raw">{f.content}</pre>}
                </div>
              ))}
              {confirm === s.name
                ? <Confirm text={`Remove the skill “${s.name}”? You can undo it in History.`} label="Remove" pending={del.isPending} onYes={() => del.mutate(s.name)} onNo={() => { setConfirm(null); del.reset(); }} />
                : <div className="ln-confirm"><button className="btn sm danger" aria-label={`Remove skill ${s.name}`} onClick={() => setConfirm(s.name)}>Remove</button></div>}
              {confirm === s.name && <ErrorBox error={del.error} />}
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ---------- History ----------

function lineClass(l: string): string {
  if (l.startsWith("@@")) return "hunk";
  if (/^(\+\+\+|---|diff |index |new file|deleted file|similarity|rename |Binary)/.test(l)) return "meta";
  if (l.startsWith("+")) return "add";
  if (l.startsWith("-")) return "del";
  return "";
}

function DiffView({ ws, commit }: { ws: string; commit: string }) {
  const q = useQueryResult(ws, commit);
  if (q.isLoading) return <p className="empty">Loading…</p>;
  if (q.error) return <ErrorBox error={q.error} />;
  const lines = (q.data?.diff ?? "").replace(/\n$/, "").split("\n");
  return <pre className="dpatch lh-diff" style={{ border: "1px solid var(--line)", borderRadius: 6, marginTop: 8, background: "var(--bg)" }} tabIndex={0} aria-label="Changes">{lines.map((l, i) => <span key={i} className={`dl ${lineClass(l)}`}>{l || " "}{"\n"}</span>)}</pre>;
}
function useQueryResult(ws: string, commit: string) {
  return useQuery({ queryKey: ["learning", ws, "diff", commit], queryFn: () => api.learningDiff(ws, commit), staleTime: Infinity });
}

const FILE_TONE: Record<string, [string, string]> = { A: ["add", "added"], M: ["mod", "changed"], D: ["del", "removed"] };

export function HistoryItem({ ws, e, names, showUndo = true }: { ws: string; e: HistoryEntry; names: Map<string, string>; showUndo?: boolean }) {
  const inv = useInvalidate();
  const [diff, setDiff] = useState(false);
  const [undo, setUndo] = useState(false);
  const m = useMutation({ mutationFn: () => api.undoLearning(ws, e.commit), onSuccess: () => { setUndo(false); inv(); } });
  const paras = e.body.trim().split(/\n\s*\n/);
  const thread = /^Thread:\s*(\S+)/m.exec(e.body)?.[1];
  const reason = (paras[0] ?? "").split("\n").filter((l) => !/^Thread:/.test(l)).join(" ").trim();
  const who = agentLabel(e.author, names);
  const isUndo = /^Undo\b/i.test(e.subject);
  return (
    <li className="ln-card">
      <div className="ln-head">
        <div className="nm"><Avatar id={e.author} name={who} /><span>{e.subject}</span>{isUndo && <Chip>undo</Chip>}</div>
        <span className="ln-sub" title={clock(e.at)}>{who} · {ago(e.at)}</span>
      </div>
      {reason && <div className="ln-reason">{reason}</div>}
      {thread && <div className="ln-sub" style={{ marginTop: 4 }}>from <Link to={`/threads/${thread}`} className="mono">{thread}</Link></div>}
      {e.files.length > 0 && <div className="ln-chips">{e.files.map((f) => { const [c, l] = FILE_TONE[f.status] ?? ["", f.status]; return <span key={f.path} className={`chip ${c}`} title={l}>{l} · <span className="mono">{f.path}</span></span>; })}</div>}
      <div className="ln-confirm">
        <button className="btn sm" aria-expanded={diff} onClick={() => setDiff(!diff)}>{diff ? "Hide change" : "View change"}</button>
        {showUndo && !isUndo && !undo && <button className="btn sm" onClick={() => setUndo(true)}>Undo</button>}
      </div>
      {diff && <DiffView ws={ws} commit={e.commit} />}
      {undo && <Confirm text="Undo this change? The agent goes back to how it was before." label="Undo" pending={m.isPending} onYes={() => m.mutate()} onNo={() => { setUndo(false); m.reset(); }} />}
      <ErrorBox error={m.error} />
    </li>
  );
}

export function HistoryTab({ agentId }: { agentId: string }) {
  const app = useApp();
  const ws = app.workspace!;
  const q = useAgentLearning(ws, agentId);
  const names = useNames();
  const rows = q.data ?? [];
  return (
    <div className="main-body">
      <ErrorBox error={q.error} />
      {q.isLoading && <p className="empty">Loading…</p>}
      {q.isSuccess && rows.length === 0 && <div className="empty-state"><h3>No changes yet</h3><p>Every time this agent remembers, forgets or saves a skill, it shows up here, and you can undo it.</p></div>}
      <ol className="ln-timeline">{rows.map((e) => <HistoryItem key={e.commit} ws={ws} e={e} names={names} />)}</ol>
    </div>
  );
}

// ---------- Workspace knowledge ----------

export function KnowledgeSection() {
  const app = useApp();
  const ws = app.workspace!;
  const inv = useInvalidate();
  const q = useKnowledge(ws);
  const names = useNames();
  const saved = q.data?.content ?? "";
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState(false);
  useEffect(() => { if (q.data && (!loaded || draft === saved)) { setDraft(q.data.content); setLoaded(true); } }, [q.data?.content]); // eslint-disable-line react-hooks/exhaustive-deps
  const size = bytes(draft);
  const m = useMutation({ mutationFn: () => api.saveKnowledge(ws, draft), onSuccess: () => { inv(); app.toast("Knowledge saved"); } });
  const changed = draft !== saved;
  const wsName = app.workspaces.find((w) => w.id === ws)?.name ?? ws;
  return (
    <>
      <p className="muted" style={{ marginTop: 0, maxWidth: 700 }}>Shared with every agent of the {wsName} workspace, in every run. Only you can change it.</p>
      <ErrorBox error={q.error} />
      {q.isLoading ? <p className="empty">Loading…</p> : (
        <div style={{ maxWidth: 900 }}>
          <div className="tabs" role="tablist" aria-label="Knowledge view">
            <button className="tab" role="tab" aria-selected={!preview} onClick={() => setPreview(false)}>Edit</button>
            <button className="tab" role="tab" aria-selected={preview} onClick={() => setPreview(true)}>Preview</button>
          </div>
          {preview
            ? <div className="kn-preview">{draft.trim() ? <Markdown text={draft} /> : <p className="faint">Nothing to preview.</p>}</div>
            : <textarea className="kn-edit" aria-label="Workspace knowledge (Markdown)" value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder={"# Conventions\n- Branches are named feature/<ticket>.\n\n# Glossary\n- Checkout: the cart-to-payment flow.\n\n# Where things are\n- Runbooks live in docs/runbooks.\n\n# People and roles\n- Maria: product owner. Ask her before changing prices."} />}
          <div className="kn-bar">
            <span className={`faint mono ${size > KB32 ? "kn-over" : ""}`} aria-live="polite">{(size / 1024).toFixed(1)} / 32 KB</span>
            <span className="grow" />
            {m.isSuccess && !changed && <span className="faint" role="status">Saved</span>}
            <button className="btn primary" disabled={!changed || size > KB32 || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Saving…" : "Save"}</button>
          </div>
          <ErrorBox error={m.error} />
          <div className="section-title"><span>History</span></div>
          {(q.data?.history ?? []).length === 0 ? <p className="empty">No changes yet.</p> : (
            <ol className="ln-timeline">{(q.data?.history ?? []).slice(0, 10).map((e) => <HistoryItem key={e.commit} ws={ws} e={e} names={names} showUndo={false} />)}</ol>
          )}
        </div>
      )}
    </>
  );
}
