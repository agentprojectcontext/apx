// UI navigation state (what is open), separate from data. Plain store so any component can navigate.
import type { ApxMode } from "@apx/ui";
import { createStore, useSlice } from "../data/createStore.ts";

export type PanelKind = "browser" | "terminal" | "files" | "widget" | "usage";

export type NavState = {
  view: "inbox" | "app";
  /** Inbox filter (sidebar project). */
  projectId: string | undefined;
  threadId: string | undefined;
  appId: string | undefined;
  panel: PanelKind | null;
  browserTab: string | undefined;
  mode: ApxMode;
  /** Show tool-call groups in transcripts (chat header wrench). */
  tools: boolean;
};

const THEME_KEY = "apx.mode";

function initialMode(): ApxMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // Storage blocked: fall through to the system preference.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const PANELS: readonly PanelKind[] = ["browser", "terminal", "files", "widget", "usage"];

/** Deep links: #thread=<id>&panel=<kind>&app=<id>. Only what is worth sharing or reloading into. */
function fromHash(): Partial<NavState> {
  const h = new URLSearchParams(window.location.hash.slice(1));
  const panel = h.get("panel");
  const app = h.get("app");
  return {
    ...(h.get("thread") ? { threadId: h.get("thread") ?? undefined } : {}),
    ...(panel && (PANELS as readonly string[]).includes(panel) ? { panel: panel as PanelKind } : {}),
    ...(app ? { view: "app" as const, appId: app } : {}),
  };
}

export const nav = createStore<NavState>({
  view: "inbox",
  projectId: undefined,
  threadId: "home",
  appId: undefined,
  panel: null,
  browserTab: undefined,
  mode: initialMode(),
  tools: true,
  ...fromHash(),
});

nav.subscribe(() => {
  const s = nav.get();
  const h = new URLSearchParams();
  if (s.view === "app" && s.appId) h.set("app", s.appId);
  else if (s.threadId) h.set("thread", s.threadId);
  if (s.panel) h.set("panel", s.panel);
  const next = `#${h.toString()}`;
  if (window.location.hash !== next) history.replaceState(null, "", next);
});

export function useNav<T>(select: (s: NavState) => T): T {
  return useSlice(nav, select);
}

export const go = {
  inbox(projectId?: string) {
    nav.set({ view: "inbox", projectId });
  },
  thread(threadId: string) {
    nav.set({ view: "inbox", threadId });
  },
  app(appId: string) {
    nav.set({ view: "app", appId });
  },
  panel(panel: PanelKind | null) {
    nav.set({ panel });
  },
  togglePanel(panel: PanelKind) {
    nav.set((s) => ({ panel: s.panel === panel ? null : panel }));
  },
  browser(tab?: string) {
    nav.set((s) => ({ panel: "browser", browserTab: tab ?? s.browserTab, view: "inbox" }));
  },
  toggleTools() {
    nav.set((s) => ({ tools: !s.tools }));
  },
  toggleMode() {
    const mode: ApxMode = nav.get().mode === "dark" ? "light" : "dark";
    nav.set({ mode });
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // Not persisted: fine.
    }
  },
};
