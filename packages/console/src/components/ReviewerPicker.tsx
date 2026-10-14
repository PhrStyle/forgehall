import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Reviewer } from "../api";
import { ErrorBox } from "../ui";

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Search the host's people for a pull request and pick reviewers. Selection is controlled by the parent. */
export function ReviewerPicker({ threadId, selected, onChange }: { threadId: string; selected: Reviewer[]; onChange: (r: Reviewer[]) => void }) {
  const [text, setText] = useState("");
  const term = useDebounced(text.trim(), 300);
  const enabled = term.length >= 2;
  const q = useQuery({ queryKey: ["reviewers", threadId, term], queryFn: () => api.reviewers(threadId, term), enabled, retry: false, staleTime: 60_000 });
  const listId = useId();
  const chosen = new Set(selected.map((r) => r.id));
  const results = (q.data ?? []).filter((r) => !chosen.has(r.id));
  const add = (r: Reviewer) => { onChange([...selected, r]); setText(""); };
  return (
    <div className="field" style={{ marginBottom: 10 }}>
      <label htmlFor={`${listId}-in`}>Reviewers</label>
      {selected.length > 0 && (
        <ul style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", margin: 0, padding: 0 }} aria-label="Selected reviewers">
          {selected.map((r) => (
            <li key={r.id}>
              <span className="chip">{r.displayName}
                <button type="button" className="btn sm ghost" style={{ padding: "0 4px", minHeight: 0, lineHeight: 1.2 }} aria-label={`Remove reviewer ${r.displayName}`}
                  onClick={() => onChange(selected.filter((x) => x.id !== r.id))}>×</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <input id={`${listId}-in`} value={text} placeholder="Search by name or e-mail (2+ characters)" autoComplete="off" spellCheck={false}
        aria-controls={listId} onChange={(e) => setText(e.target.value)} />
      {selected.length === 0 && <span className="faint">No reviewers selected</span>}
      {text.trim().length > 0 && !enabled && <span className="faint">Type at least 2 characters.</span>}
      <ErrorBox error={q.error} />
      <div id={listId} aria-live="polite">
        {enabled && q.isFetching && <span className="faint">Searching…</span>}
        {enabled && q.isSuccess && !q.isFetching && results.length === 0 && <span className="faint">No matches.</span>}
        {results.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {results.slice(0, 8).map((r) => (
              <li key={r.id}>
                <button type="button" className="btn sm ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => add(r)}>
                  {r.displayName} <span className="faint mono">{r.uniqueName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
