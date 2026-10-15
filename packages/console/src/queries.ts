import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { api, type Run } from "./api";

export const useWorkspaces = () => useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces, retry: false, refetchInterval: (q) => (q.state.status === "error" ? 5000 : false) });
export const useAgents = (ws: string | null) => useQuery({ queryKey: ["agents", ws], queryFn: () => api.agents(ws!), enabled: !!ws, placeholderData: keepPreviousData, refetchInterval: 30_000 });
export const useSupervisor = () => useQuery({ queryKey: ["supervisor"], queryFn: api.supervisor, refetchInterval: 10_000, retry: false });
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

export const useRepos = (ws: string | null) => useQuery({ queryKey: ["repos", ws], queryFn: () => api.repos(ws!), enabled: !!ws, placeholderData: keepPreviousData });
// Both live under ["thread", id], so every SSE invalidation of the thread refetches them too.
export const useDiff = (id: string | undefined, enabled: boolean) => useQuery({ queryKey: ["thread", id, "diff"], queryFn: () => api.diff(id!), enabled: !!id && enabled, retry: false });
export const useApprovals = (id: string | undefined, enabled: boolean) => useQuery({ queryKey: ["thread", id, "approvals"], queryFn: () => api.approvals(id!), enabled: !!id && enabled });
export const usePermissions = (ws: string | null) => useQuery({ queryKey: ["permissions", ws], queryFn: () => api.permissions(ws!), enabled: !!ws, placeholderData: keepPreviousData, refetchInterval: 30_000 });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: api.settings });
export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
export const usePublishing = (ws: string | null) => useQuery({ queryKey: ["publishing", ws], queryFn: () => api.publishing(ws!), enabled: !!ws });
export const useAgentSettings = (ws: string | null, id: string | undefined) => useQuery({ queryKey: ["agentSettings", ws, id], queryFn: () => api.agentSettings(ws!, id!), enabled: !!ws && !!id });

// Schedules and their calendars share the ["schedules", ws] prefix, so one invalidation refreshes both.
export const useSchedules = (ws: string | null) => useQuery({ queryKey: ["schedules", ws], queryFn: () => api.schedules(ws!), enabled: !!ws, placeholderData: keepPreviousData });
export const useScheduleCalendar = (ws: string | null, from: string, to: string, enabled = true) =>
  useQuery({ queryKey: ["schedules", ws, "calendar", from, to], queryFn: () => api.scheduleCalendar(ws!, from, to), enabled: !!ws && enabled, placeholderData: keepPreviousData });
