import { useApp } from "../context";
import { ErrorBox } from "../ui";

export function NoWorkspace() {
  const app = useApp();
  if (app.offline) {
    return (
      <div className="main-body">
        <div className="empty-state">
          <h3>The bus is not reachable</h3>
          <p>The console talks to the bus through the dev server proxy. Start it from the repository root:</p>
          <div className="term"><span className="p">$</span> docker compose -f infra/docker/compose.yaml -p forgehall up -d</div>
        </div>
      </div>
    );
  }
  if (app.workspacesError) return <div className="main-body"><ErrorBox error={app.workspacesError} /></div>;
  if (!app.workspacesLoaded) return <div className="main-body"><p className="empty">Loading…</p></div>;
  return (
    <div className="main-body">
      <div className="empty-state">
        <h3>No workspaces yet</h3>
        <p>A workspace holds a team of agents and its threads. Create one and add your first agents with the CLI:</p>
        <div className="term">
          <span className="p">$</span> fh workspace add dev "Dev"<br />
          <span className="p">$</span> fh agent add dev vigil --name Vigil --role QA --model haiku<br />
          <span className="p">$</span> fh agent add dev atlas --name Atlas --role Dev --model haiku
        </div>
        <p className="faint">This page refreshes by itself once a workspace exists.</p>
      </div>
    </div>
  );
}
