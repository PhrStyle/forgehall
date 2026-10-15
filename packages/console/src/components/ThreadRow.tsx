import { Link } from "react-router-dom";
import type { ThreadOverview } from "../api";
import { Chip, People, WaitBadge } from "../ui";
import { ago, STATE_LABEL, stateTone } from "../util";

export function ThreadRow({ t }: { t: ThreadOverview }) {
  return (
    <Link to={`/threads/${t.id}`} className={`trow ${t.waiting_on_you ? "wait" : ""}`}>
      <div>
        <div className="t1">
          <Chip><span className="mono">{t.id}</span></Chip>
          <b>{t.title}</b>
          <Chip tone={stateTone(t.state)}>{STATE_LABEL[t.state]}</Chip>
          {t.severity && <Chip tone={t.severity === "high" ? "err" : t.severity === "medium" ? "warn" : ""}>{t.severity}</Chip>}
          {t.repo_id && <Chip><span className="mono">{t.repo_id}{t.branch ? ` · ${t.branch}` : ""}</span></Chip>}
          {t.waiting_on_you && <WaitBadge reason={t.waiting_reason} />}
        </div>
        <div className="t2">
          <People ids={(t.participants ?? []).filter((p) => p !== "system")} />
          <span>assignee <span className="mono">{t.assignee ?? "none"}</span></span>
          <span>{t.message_count} message{t.message_count === 1 ? "" : "s"}</span>
        </div>
      </div>
      <span className="tupd faint mono">{ago(t.updated_at)}</span>
    </Link>
  );
}
