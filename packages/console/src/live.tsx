import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type LiveStatus = "live" | "reconnecting";
const Ctx = createContext<LiveStatus>("reconnecting");
export const useLiveStatus = () => useContext(Ctx);

interface Change { kind: "thread" | "message" | "run" | "run_event"; workspace: string; thread?: string; message?: number; run?: number; state?: string }

/** One SSE stream per workspace; every change invalidates the queries it can affect. */
export function LiveProvider({ workspace, children }: { workspace: string | null; children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("reconnecting");

  useEffect(() => {
    if (!workspace) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;

    const handle = (e: MessageEvent) => {
      let c: Change;
      try { c = JSON.parse(e.data) as Change; } catch { return; }
      const ws = workspace;
      const inv = (key: unknown[]) => void qc.invalidateQueries({ queryKey: key });
      switch (c.kind) {
        case "thread":
        case "message":
          inv(["threads", ws]);
          inv(["agents", ws]);
          if (c.thread) inv(["thread", c.thread]);
          break;
        case "run":
          inv(["agents", ws]);
          inv(["threads", ws]);
          inv(["runs", ws]);
          inv(["usage", ws]);
          if (c.thread) inv(["thread", c.thread]);
          if (c.run != null) inv(["runEvents", String(c.run)]);
          break;
        case "run_event":
          if (c.run != null) inv(["runEvents", String(c.run)]);
          break;
      }
    };

    const connect = () => {
      es = new EventSource(`/api/events?workspace=${encodeURIComponent(workspace)}`);
      es.onopen = () => { attempt = 0; setStatus("live"); void qc.invalidateQueries(); };
      for (const k of ["thread", "message", "run", "run_event"]) es.addEventListener(k, handle as EventListener);
      es.onerror = () => {
        setStatus("reconnecting");
        es?.close();
        if (closed) return;
        const delay = Math.min(15_000, 500 * 2 ** attempt++);
        timer = setTimeout(connect, delay);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); es?.close(); setStatus("reconnecting"); };
  }, [workspace, qc]);

  return <Ctx.Provider value={status}>{children}</Ctx.Provider>;
}
