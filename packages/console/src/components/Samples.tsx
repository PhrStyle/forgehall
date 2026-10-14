import { Chip, PreviewBadge } from "../ui";

export type SampleTab = "memory" | "skills" | "environment" | "versions";

const MEMORY = [
  { t: "Checkout depends on the coupon seed", type: "project", when: "2 days", pending: true },
  { t: "Prefer fake timers over real sleeps in timeout tests", type: "feedback", when: "5 days" },
  { t: "Release notes live in docs/changelog", type: "reference", when: "12 days" },
];
const SKILLS = [
  { n: "flaky-test-triage", src: "created by the agent", v: "v2", d: "Re-run isolated 5 times, collect a trace when it fails fewer than 5, then open a task with the trace attached.", uses: 4, pending: false },
  { n: "pr-checklist", src: "inherited from the team", v: "v1", d: "Run tests, check the title format, link the work item, pick reviewers.", uses: 9, pending: false },
  { n: "seed-before-e2e", src: "proposal", v: "v1", d: "Run the seed script before any end-to-end suite.", uses: 0, pending: true },
];
const VERSIONS = [
  { h: "c41e9a2", m: "Add skill flaky-test-triage", when: "2 days ago", tag: "v12" },
  { h: "8d2f0b7", m: "Memory: checkout depends on the coupon seed", when: "5 days ago", tag: "" },
  { h: "77e1a02", m: "Initial agent definition", when: "1 month ago", tag: "v1" },
];
const DIFF = `+ ---\n+ name: checkout-needs-coupon-seed\n+ type: project\n+ ---\n+ Before the checkout/ suite, run \`npm run seed:coupons\`.\n+ **Why:** without coupons the discount step breaks 3 tests.`;

export function SamplePanels({ tab, agentId }: { tab: SampleTab; agentId: string }) {
  return (
    <div className="sample">
      <PreviewBadge />
      {tab === "memory" && (
        <>
          <div className="section-title"><span>memory/ · {MEMORY.length} files</span><button className="btn sm" disabled>Consolidate memory</button></div>
          <div className="list">{MEMORY.map((x) => (
            <div key={x.t} className="li"><div><div className="t">{x.t} {x.pending && <Chip tone="warn">awaiting review</Chip>}</div><div className="d mono">{x.type} · updated {x.when} ago</div>
              {x.pending && <div className="detail" style={{ marginTop: 8 }}>{DIFF.split("\n").map((l, i) => <span key={i} className={l[0] === "+" ? "add" : ""}>{l}{"\n"}</span>)}</div>}</div>
              <div className="r"><Chip tone={x.type === "feedback" ? "warn" : x.type === "project" ? "sonnet" : "haiku"}>{x.type}</Chip></div></div>
          ))}</div>
        </>
      )}
      {tab === "skills" && (
        <>
          <div className="section-title"><span>skills/ · created by the agent or inherited from the team</span><button className="btn sm" disabled>Promote to team</button></div>
          <div className="grid">{SKILLS.map((x) => (
            <div key={x.n} className="tile"><div className="top"><div className="who"><b className="mono" style={{ fontSize: 13 }}>{x.n}</b><span>{x.src} · {x.v}</span></div></div>
              <div className="now muted">{x.d}</div>
              <div className="foot"><span className="faint mono num">{x.uses} uses</span>{x.pending ? <Chip tone="warn">proposal</Chip> : <Chip tone="ok">active</Chip>}</div></div>
          ))}</div>
        </>
      )}
      {tab === "environment" && (
        <>
          <div className="section-title"><span>Runner</span><Chip tone="ok">healthy</Chip></div>
          <div className="kv"><div><span>Instance</span><b className="mono">{agentId}-dev</b></div><div><span>Image</span><b className="mono">dev-node22@2026.10.2</b></div><div><span>Resources</span><b>2 vCPU · 8 GB · 20 GB</b></div><div><span>Network</span><b>allowlist · 4 domains</b></div></div>
          <div className="section-title"><span>Snapshots</span><button className="btn sm" disabled>Create snapshot</button></div>
          <div className="list">{[["pre-sprint-42", "today 08:00"], ["post-seed-staging", "yesterday 17:40"], ["baseline", "Oct 12 09:00"]].map(([n, w]) => (
            <div key={n} className="li"><div><div className="t mono">{n}</div><div className="d">{w}</div></div><div className="r"><button className="btn sm" disabled>Restore</button></div></div>
          ))}</div>
          <div className="section-title"><span>Terminal (read only)</span></div>
          <div className="term"><span className="p">{agentId}@runner</span>:~/work$ git status<br />On branch agent/{agentId}/work<br />nothing to commit, working tree clean</div>
        </>
      )}
      {tab === "versions" && (
        <>
          <div className="section-title"><span>agents/{agentId}/ in git</span><button className="btn sm" disabled>Tag version</button></div>
          <div className="list">{VERSIONS.map((x) => (
            <div key={x.h} className="li"><div><div className="t"><span className="mono faint">{x.h}</span> {x.m} {x.tag && <Chip>{x.tag}</Chip>}</div><div className="d">{x.when}</div></div>
              <div className="r"><button className="btn sm ghost" disabled>Diff</button><button className="btn sm" disabled>Roll back to this</button></div></div>
          ))}</div>
        </>
      )}
    </div>
  );
}
