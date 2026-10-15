import "../styles/agent-settings.css";

export type SampleTab = "memory" | "skills" | "environment" | "versions";

const PLANNED: Record<SampleTab, { title: string; text: string }> = {
  memory: { title: "Memory", text: "Notes the agent keeps between runs: facts about the project, your feedback and where things live. You will be able to read them here, and review what the agent wants to remember." },
  skills: { title: "Skills", text: "Reusable procedures the agent writes down or inherits from the team, such as how to triage a flaky test. You will be able to see which ones exist and promote the good ones to the whole team." },
  environment: { title: "Environment", text: "The machine the agent works on: image, resources, network rules and snapshots you can restore. Today you can see and control the container from the header above." },
  versions: { title: "Versions", text: "The history of this agent's definition, memory and skills, with the option to compare and roll back to an earlier version." },
};

/** Honest empty state for tabs that are planned and not built yet. No sample data. */
export function SamplePanels({ tab }: { tab: SampleTab; agentId?: string }) {
  const p = PLANNED[tab];
  return (
    <div className="empty-state planned">
      <h3>{p.title}</h3>
      <p style={{ margin: 0 }}>{p.text}</p>
      <span className="chip">Coming in a later phase</span>
    </div>
  );
}
