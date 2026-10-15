import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type AgentOverview, type ContainerState } from "../api";
import { useSupervisor } from "../queries";
import { Chip, ErrorBox, WaitBadge } from "../ui";
import "../styles/agent-settings.css";
import { CopyCommand } from "./CopyCommand";

/** One quiet banner while the supervisor is not reporting. Renders nothing until the first answer. */
export function SupervisorBanner() {
  const q = useSupervisor();
  if (!q.data || q.data.online) return null;
  return (
    <div className="banner warn" role="status">
      <span>The supervisor is not running, so agents are not started or stopped from here. Start it once on this machine:</span>
      <CopyCommand command="fh supervise --install" />
    </div>
  );
}

/** What to do for an agent whose runner is offline. */
export function StartHint({ ws, agentId }: { ws: string; agentId: string }) {
  const online = useSupervisor().data?.online === true;
  if (online) return <p className="muted" style={{ maxWidth: 700, margin: "0 0 8px" }}>Starting… the supervisor starts it in a few seconds.</p>;
  return (
    <>
      <p className="muted" style={{ maxWidth: 700, margin: "0 0 8px" }}>This agent's runner is offline. Start the supervisor once (<span className="mono">fh supervise --install</span>), or start this agent by hand:</p>
      <CopyCommand command={`fh agent run ${ws} ${agentId}`} />
    </>
  );
}

const LABEL: Record<ContainerState, string> = { running: "Running", stopped: "Stopped", starting: "Starting…", stopping: "Stopping…", restarting: "Restarting…", updating: "Updating…", error: "Error" };

/** One chip for the whole agent: container state first, then what it is doing. */
export function AgentStatusChip({ a }: { a: AgentOverview }) {
  const cs = a.container_state;
  const detail = a.container_detail ?? undefined;
  if (cs === "error") return <span title={detail}><Chip tone="err">Error</Chip></span>;
  if (cs === "starting" || cs === "restarting" || cs === "updating" || cs === "stopping") return <span title={detail}><Chip tone="warn">{LABEL[cs]}</Chip></span>;
  if (cs === "stopped" || (!cs && a.desired_state === "stopped")) return <Chip>Stopped</Chip>;
  if (a.run_id) {
    const label = a.run_thread ? `Working on ${a.run_thread}` : "Working";
    const chip = <Chip tone="ok">{label}</Chip>;
    return a.run_thread ? <Link to={`/threads/${a.run_thread}`} className="status-link">{chip}</Link> : chip;
  }
  if (a.waiting_thread) return <Link to={`/threads/${a.waiting_thread}`} className="status-link wait-link"><WaitBadge label="Waiting for your answer" /></Link>;
  if (a.runner_online === false) return cs === "running" ? <Chip tone="warn">Starting…</Chip> : <Chip tone="err">Offline</Chip>;
  if (a.queued > 0) return <Chip tone="warn">{a.queued} queued</Chip>;
  if (a.last_state === "failed") return <span title={a.last_error ?? undefined}><Chip tone="err">Last run failed</Chip></span>;
  return <Chip>Idle</Chip>;
}

/** Error detail, or a quiet note such as a pending update. */
export function ContainerNote({ a }: { a: AgentOverview }) {
  if (!a.container_detail) return null;
  const err = a.container_state === "error";
  return <div className={err ? "errbox" : "faint"} style={{ margin: err ? "6px 0 0" : "4px 0 0", fontSize: 12 }}>{a.container_detail}</div>;
}

export function AgentControls({ a, ws }: { a: AgentOverview; ws: string }) {
  const qc = useQueryClient();
  const done = { onSettled: () => { void qc.invalidateQueries({ queryKey: ["agents"] }); } };
  const start = useMutation({ mutationFn: () => api.startAgent(ws, a.id), ...done });
  const stop = useMutation({ mutationFn: () => api.stopAgent(ws, a.id), ...done });
  const restart = useMutation({ mutationFn: () => api.restartAgent(ws, a.id), ...done });
  const busy = start.isPending || stop.isPending || restart.isPending;
  const err = start.error ?? stop.error ?? restart.error;
  return (
    <>
      {a.desired_state === "stopped" ? (
        <button className="btn" disabled={busy} aria-label={`Start ${a.name}`} onClick={() => start.mutate()}>Start</button>
      ) : a.desired_state === "running" ? (
        <>
          <button className="btn" disabled={busy} aria-label={`Restart ${a.name}`} onClick={() => restart.mutate()}>Restart</button>
          <button className="btn" disabled={busy} aria-label={`Stop ${a.name}`} onClick={() => stop.mutate()}>Stop</button>
        </>
      ) : null}
      {err && <ErrorBox error={err} />}
    </>
  );
}
