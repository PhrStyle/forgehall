import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type RepoProvider, type RepoRow } from "../api";
import { usePublishing, useRepos } from "../queries";
import { slugify } from "../util";
import { Chip, ErrorBox } from "../ui";

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;
export const HOST_LABEL: Record<RepoProvider, string> = { github: "GitHub", "azure-devops": "Azure DevOps", local: "Local" };

/** Same rule as the bus: github.com, dev.azure.com and *.visualstudio.com are hosted; anything else is local. */
export function detectProvider(url: string): RepoProvider | null {
  const u = url.trim();
  if (!u) return null;
  let host = "";
  try { host = new URL(u).hostname.toLowerCase(); } catch {
    const m = u.match(/^[^@\s]+@([^:/\s]+)[:/]/); // scp-like: git@github.com:acme/x.git
    host = m?.[1]?.toLowerCase() ?? "";
  }
  if (host === "github.com" || host === "www.github.com") return "github";
  if (host === "dev.azure.com" || host.endsWith(".visualstudio.com")) return "azure-devops";
  return "local";
}

/** Repository name at the end of the URL, without ".git". */
function repoName(url: string): string {
  const path = url.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  const last = path.split(/[/:]/).pop() ?? "";
  return last.replace(/\.git$/i, "");
}

export function AddRepoModal({ ws, onClose, onAdded }: { ws: string; onClose: () => void; onAdded?: (repo: RepoRow) => void }) {
  const qc = useQueryClient();
  const repos = useRepos(ws).data ?? [];
  const creds = usePublishing(ws).data?.credentials;
  const [upstream, setUpstream] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [base, setBase] = useState("main");
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  const m = useMutation({
    mutationFn: () => api.addRepo(ws, { id, upstream: upstream.trim(), ...(base.trim() ? { base: base.trim() } : {}) }),
    onSuccess: async (repo) => {
      await qc.invalidateQueries({ queryKey: ["repos", ws] });
      onAdded?.(repo);
      onClose();
    },
  });

  const provider = detectProvider(upstream);
  const missingCred = provider && provider !== "local" && creds && !creds.some((c) => c.provider === provider);
  const idOk = ID_RE.test(id);
  const dup = idOk && repos.some((r) => r.id.toLowerCase() === id.toLowerCase());
  const valid = upstream.trim() !== "" && idOk && !dup && !m.isPending;
  const submit = (e: FormEvent) => { e.preventDefault(); if (valid) m.mutate(); };

  return (
    <div className="scrim modal" onMouseDown={(e) => { if (e.target === e.currentTarget && !m.isPending) onClose(); }}>
      <form className="modal-box" role="dialog" aria-modal="true" aria-label="Add repository" onSubmit={submit}>
        <h3>Add repository</h3>
        <label className="field">Upstream URL
          <input ref={first} value={upstream} spellCheck={false} placeholder="https://github.com/acme/checkout-app or https://dev.azure.com/acme/Shop/_git/checkout-app"
            onChange={(e) => { setUpstream(e.target.value); if (!idTouched) setId(slugify(repoName(e.target.value))); }} />
          <span className="faint">
            {provider ? <>Host: <Chip tone={provider === "local" ? undefined : "sonnet"}>{HOST_LABEL[provider]}</Chip> · </> : null}
            Local paths: use <code>fh repo add</code>.
          </span>
        </label>
        {missingCred && provider && (
          <div className="warnbox" role="status">No {HOST_LABEL[provider]} token for this workspace: add one in Settings → Publishing first (needed for private repositories).</div>
        )}
        <label className="field">ID
          <input className="mono" value={id} maxLength={60} aria-invalid={id !== "" && (!idOk || dup)} onChange={(e) => { setId(e.target.value); setIdTouched(true); }} />
          {dup
            ? <span style={{ color: "var(--err)" }}>A repository with this ID already exists.</span>
            : <span className="faint">Letters, digits, dots, dashes and underscores. Used in commands.</span>}
        </label>
        <label className="field">Base branch
          <input className="mono" value={base} onChange={(e) => setBase(e.target.value)} placeholder="main" />
        </label>
        <ErrorBox error={m.error} />
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose} disabled={m.isPending}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!valid}>{m.isPending ? "Cloning…" : "Add repository"}</button>
        </div>
      </form>
    </div>
  );
}
