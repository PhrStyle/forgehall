import "../styles/agent-settings.css";

export type SampleTab = "environment";

const PLANNED: Record<SampleTab, { title: string; text: string }> = {
  environment: { title: "Environment", text: "The machine the agent works on: image, resources, network rules and snapshots you can restore. Today you can see and control the container from the header above." },
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
