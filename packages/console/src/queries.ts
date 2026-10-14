import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { api, type Run } from "./api";

export const useWorkspaces = () => useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces, retry: false, refetchInterval: (q) => (q.state.status === "error" ? 5000 : false) });
export const useAgents = (ws: string | null) => useQuery({ queryKey: ["agents", ws], queryFn: () => api.agents(ws!), enabled: !!ws, placeholderData: keepPreviousData });
export const useThreads = (ws: string | null) => useQuery({ queryKey: ["threads", ws], queryFn: () => api.threads(ws!), enabled: !!ws, placeholderData: keepPreviousData });
export const useRuns = (ws: string | null) => useQuery({ queryKey: ["runs", ws], queryFn: () => api.runs(ws!, 50), enabled: !!ws, placeholderData: keepPreviousData });
export const useUsage = (ws: string | null) => useQuery({ queryKey: ["usage", ws], queryFn: () => api.usage(ws!), enabled: !!ws, placeholderData: keepPreviousData, refetchInterval: 60_000 });
export const useThread = (id: string | undefined) => useQuery({ queryKey: ["thread", id], queryFn: () => api.thread(id!), enabled: !!id });

/** Events of several runs; each query refetches on `run_event` SSE (see live.tsx). */
export function useRunsEvents(runs: Run[]) {
  return useQueries({
    queries: runs.map((r) => ({
      queryKey: ["runEvents", String(r.id)],
      queryFn: () => api.runEvents(r.id, 0),
      // Finished runs never change; running ones are also invalidated by SSE, with a slow poll as a safety net.
      refetchInterval: r.state === "running" ? 10_000 : false,
      staleTime: r.state === "running" ? 0 : Infinity,
    })),
  });
}
