import { Link } from "react-router-dom";
import { useApp } from "../context";
import { NoWorkspace } from "../components/Empty";
import { ProposalList } from "../components/Learning";
import { PermissionList } from "../components/PermissionCard";
import { splitQuestion, ago } from "../util";
import { useLearningProposals, usePermissions, useThread, useThreads, useApprovals } from "../queries";
import { Chip, ErrorBox, WaitBadge } from "../ui";
import type { ThreadOverview } from "../api";

const REASON: Record<string, string> = { question: "Question", approval: "Approval", permission: "Permission" };

function Row({ t }: { t: ThreadOverview }) {
  const reason = t.waiting_reason ?? "question";
  const detail = useThread(reason === "question" ? t.id : undefined);
  const approvals = useApprovals(t.id, reason === "approval");
  let text = "";
  if (reason === "question") {
    const qs = detail.data?.questions ?? [];
    const q = qs.find((x) => x.message_id === t.waiting_message_id) ?? qs.find((x) => !x.answered_by);
    if (q) text = splitQuestion(q.body).head;
  } else if (reason === "approval") {
    const a = (approvals.data ?? []).find((x) => x.state === "pending");
    if (a) text = a.summary.trim().split("\n")[0] ?? "";
  }
  const to = reason === "question" && t.waiting_message_id ? `/threads/${t.id}#msg-${t.waiting_message_id}` : `/threads/${t.id}`;
  return (
    <Link to={to} className="trow wait inbox-row">
      <div>
        <div className="t1">
          <Chip><span className="mono">{t.id}</span></Chip>
          <b>{t.title}</b>
          <WaitBadge label={REASON[reason] ?? "Waiting"} />
        </div>
        {text && <div className="inbox-text">{text}</div>}
        <div className="t2"><span>agent <span className="mono">{t.assignee ?? "none"}</span></span></div>
      </div>
      <span className="tupd faint mono">{ago(t.updated_at)}</span>
    </Link>
  );
}

export function Inbox() {
  const app = useApp();
  const threads = useThreads(app.workspace);
  const perms = usePermissions(app.workspace).data ?? [];
  const props = useLearningProposals(app.workspace).data ?? [];
  if (!app.workspace) return <NoWorkspace />;
  const rows = (threads.data ?? []).filter((t) => t.waiting_on_you).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return (
    <>
      <div className="main-head">
        <div className="title-row"><h1>Inbox</h1><div className="meta">Threads, permissions and learning proposals that wait on you</div></div>
        <div />
      </div>
      <div className="main-body">
        <ErrorBox error={threads.error} />
        {perms.length > 0 && <PermissionList items={perms} />}
        <ProposalList />
        {rows.length > 0 && <div className="list">{rows.map((t) => <Row key={t.id} t={t} />)}</div>}
        {threads.isSuccess && rows.length === 0 && perms.length === 0 && props.length === 0 && <p className="empty">Nothing waits on you.</p>}
      </div>
    </>
  );
}
