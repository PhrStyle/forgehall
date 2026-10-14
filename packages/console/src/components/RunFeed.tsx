import { Link } from "react-router-dom";
import type { Run, RunEvent } from "../api";
import { Chip, Icon, ModelChip } from "../ui";
import { clock, compactInput, money, MONEY_HINT, runDuration } from "../util";

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : c?.text ?? JSON.stringify(c))).join("\n");
  return content == null ? "" : JSON.stringify(content);
}

export function RunHeader({ run }: { run: Run }) {
  const dur = runDuration(run);
  return (
    <div className="ev">
      <span className="ico"><Icon n="task" /></span>
      <div>
        <div className="hd">
          <b>Run #{run.id}</b>
          {run.thread_id && <Link to={`/threads/${run.thread_id}`} className="mono">{run.thread_id}</Link>}
          <time>{clock(run.started_at ?? run.queued_at)}</time>
        </div>
        <div className="card route">
          <ModelChip model={run.model} effort={run.effort} />
          {run.route_reason && <><span className="arrow">·</span><span>{run.route_reason}</span></>}
          <span className="arrow">·</span>
          <Chip tone={run.state === "done" ? "ok" : run.state === "failed" ? "err" : run.state === "running" ? "warn" : ""}>{run.state}</Chip>
          {dur && <span className="mono">{dur}</span>}
          {run.cost_usd != null && <span className="mono" title={MONEY_HINT}>{money(run.cost_usd)}</span>}
        </div>
      </div>
    </div>
  );
}

export function EventView({ e }: { e: RunEvent }) {
  const p = e.payload ?? {};
  const t = clock(e.ts);
  switch (e.kind) {
    case "system.init":
      return (
        <div className="ev"><span className="ico"><Icon n="info" /></span><div>
          <div className="hd"><b>Session started</b><time>{t}</time></div>
          <div className="body muted" style={{ fontSize: 12.5 }}>{p.model && <span className="mono">{p.model}</span>} · {(p.tools ?? []).length} tools · {(p.mcp_servers ?? []).length} MCP server{(p.mcp_servers ?? []).length === 1 ? "" : "s"}</div>
        </div></div>
      );
    case "assistant":
      return <>{(p.message?.content ?? []).map((c: any, i: number) => <AssistantBlock key={i} c={c} t={t} />)}</>;
    case "user":
      return <>{(p.message?.content ?? []).map((c: any, i: number) => (c?.type === "tool_result" ? <ToolResult key={i} c={c} t={t} /> : null))}</>;
    default:
      if (e.kind.startsWith("result")) return <ResultLine kind={e.kind} p={p} t={t} />;
      return null; // rate_limit_event, post_turn_summary, thinking_tokens: not shown in the feed
  }
}

function AssistantBlock({ c, t }: { c: any; t: string }) {
  if (c?.type === "text" && c.text?.trim()) {
    return <div className="ev"><span className="ico"><Icon n="say" /></span><div><div className="hd"><b>Agent</b><time>{t}</time></div><div className="body"><p style={{ whiteSpace: "pre-wrap" }}>{c.text}</p></div></div></div>;
  }
  if (c?.type === "tool_use") {
    const name: string = c.name ?? "tool";
    if (name.startsWith("mcp__bus__")) {
      const verb = name.replace("mcp__bus__", "");
      const inp = c.input ?? {};
      const text: string | undefined = [inp.body, inp.question, inp.answer, inp.summary, inp.message, inp.title, inp.reason].find((v) => typeof v === "string");
      return (
        <div className="ev"><span className="ico" style={{ color: "var(--sonnet)" }}><Icon n="dm" /></span><div>
          <div className="hd"><b>{verb}</b><Chip tone="sonnet">bus</Chip>{inp.to && <span className="muted">→ {inp.to}</span>}<time>{t}</time></div>
          {text ? <div className="dm busmsg" style={{ whiteSpace: "pre-wrap", padding: "6px 12px" }}>{text}</div> : <div className="card tool"><span className="out">{compactInput(inp)}</span></div>}
        </div></div>
      );
    }
    return (
      <div className="ev"><span className="ico"><Icon n="tool" /></span><div>
        <div className="hd"><b>{name}</b><time>{t}</time></div>
        <div className="card tool"><span className="cmd">{compactInput(c.input)}</span></div>
      </div></div>
    );
  }
  return null; // thinking blocks are not shown
}

function ToolResult({ c, t }: { c: any; t: string }) {
  const text = toolResultText(c.content);
  const err = !!c.is_error;
  return (
    <div className="ev"><span className="ico" style={err ? { color: "var(--err)" } : undefined}><Icon n={err ? "info" : "result"} /></span><div>
      <details><summary>{err ? "Tool error" : "Tool result"} · {text.length} chars <time className="mono faint">{t}</time></summary>
        <div className="card tool"><span className="out" style={err ? { color: "var(--err)" } : undefined}>{text.slice(0, 4000)}{text.length > 4000 ? "\n…" : ""}</span></div>
      </details>
    </div></div>
  );
}

function ResultLine({ kind, p, t }: { kind: string; p: any; t: string }) {
  const ok = kind === "result.success";
  return (
    <div className="ev"><span className="ico" style={{ color: ok ? "var(--ok)" : "var(--err)" }}><Icon n="result" /></span><div>
      <div className="hd"><b>{ok ? "Run finished" : "Run failed"}</b><Chip tone={ok ? "ok" : "err"}>{kind.replace("result.", "")}</Chip>
        {p.duration_ms != null && <span className="mono muted">{(p.duration_ms / 1000).toFixed(1)}s</span>}
        {p.total_cost_usd != null && <span className="mono muted">{money(p.total_cost_usd)}</span>}
        <time>{t}</time></div>
      {p.result && <div className="body muted" style={{ whiteSpace: "pre-wrap", fontSize: 12.5 }}>{String(p.result).slice(0, 1200)}</div>}
    </div></div>
  );
}
