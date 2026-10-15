import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWorkspaces } from "./queries";
import { readLS, writeLS } from "./util";
import type { Workspace } from "./api";
import { ApiError } from "./api";

interface AppState {
  workspace: string | null;
  workspaces: Workspace[];
  workspacesLoaded: boolean;
  offline: boolean;
  workspacesError: unknown;
  setWorkspace: (id: string) => void;
  toast: (msg: ReactNode, ms?: number) => void;
  toastMsg: ReactNode | null;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  newTaskOpen: boolean;
  newTaskTo: string | null;
  openNewTask: (to?: string) => void;
  closeNewTask: () => void;
  newWorkspaceOpen: boolean;
  setNewWorkspaceOpen: (v: boolean) => void;
  addAgentOpen: boolean;
  setAddAgentOpen: (v: boolean) => void;
  /** Set after creating a workspace; the Team page shows next steps until dismissed. */
  nextSteps: string | null;
  setNextSteps: (ws: string | null) => void;
}
const Ctx = createContext<AppState | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
};

const LS_WS = "forgehall.workspace";

export function AppProvider({ children }: { children: ReactNode }) {
  const wsq = useWorkspaces();
  const [chosen, setChosen] = useState<string | null>(() => readLS(LS_WS));
  const [toastMsg, setToastMsg] = useState<ReactNode | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskTo, setNewTaskTo] = useState<string | null>(null);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [nextSteps, setNextSteps] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const workspaces = wsq.data ?? [];
  const workspace = workspaces.find((w) => w.id === chosen)?.id ?? workspaces[0]?.id ?? null;

  const setWorkspace = useCallback((id: string) => { setChosen(id); writeLS(LS_WS, id); }, []);
  const toast = useCallback((m: ReactNode, ms = 2400) => {
    setToastMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), ms);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<AppState>(() => ({
    workspace, workspaces, workspacesLoaded: wsq.isSuccess,
    offline: wsq.error instanceof ApiError && wsq.error.status === 0,
    workspacesError: wsq.error,
    setWorkspace, toast, toastMsg, paletteOpen, setPaletteOpen,
    newTaskOpen, newTaskTo,
    openNewTask: (to) => { setNewTaskTo(to ?? null); setNewTaskOpen(true); setPaletteOpen(false); },
    closeNewTask: () => setNewTaskOpen(false),
    newWorkspaceOpen, setNewWorkspaceOpen, addAgentOpen, setAddAgentOpen, nextSteps, setNextSteps,
  }), [newWorkspaceOpen, addAgentOpen, nextSteps, workspace, workspaces, wsq.isSuccess, wsq.error, setWorkspace, toast, toastMsg, paletteOpen, newTaskOpen, newTaskTo]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
