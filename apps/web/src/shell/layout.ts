// Every layout number of the shell lives here so a re-skin touches one file. See plan/design/SPEC.md §1.3.

export const LAYOUT = {
  topbarH: 46,
  /** Chat, panel and app headers. */
  headerH: 56,
  sidebarW: 236,
  sidebarRailW: 60,
  listW: 320,
  listWNarrow: 280,
  panelW: 420,
  panelWNarrow: 360,
  chatMinW: 360,
  /** Transcript + composer max width ("medio"). */
  transcriptW: 760,
  /** Inline widget iframe max height before it scrolls. */
  surfaceMaxH: 900,
} as const;

export const BREAKPOINTS = {
  /** Sidebar shows labels at or above this width, else it is an icon rail. */
  sidebarFull: 1320,
  /** Inbox list uses the wide column at or above this width. */
  listWide: 1100,
  /** Below this width the inbox list hides while the side panel is open. */
  panelWide: 1240,
  /** Chat column width from which the header shows the panel switcher as inline icons (else a dropdown). */
  chatHeaderWide: 720,
} as const;

export type Layout = {
  sidebarW: number;
  rail: boolean;
  listW: number;
  panelW: number;
  /** Chat header shows inline panel icons (true) or one dropdown (false). */
  wideHeader: boolean;
};

/** Column widths for a viewport width, following the design's breakpoints. */
export function computeLayout(width: number, panelOpen: boolean, chatShown: boolean): Layout {
  const rail = width < BREAKPOINTS.sidebarFull;
  const narrow = width < BREAKPOINTS.panelWide;
  const hideList = narrow && panelOpen && chatShown;
  const sidebarW = rail ? LAYOUT.sidebarRailW : LAYOUT.sidebarW;
  const listW = hideList ? 0 : width >= BREAKPOINTS.listWide ? LAYOUT.listW : LAYOUT.listWNarrow;
  const panelW = narrow ? LAYOUT.panelWNarrow : LAYOUT.panelW;
  const chatW = width - sidebarW - listW - (panelOpen ? panelW : 0);
  return { rail, sidebarW, listW, panelW, wideHeader: chatW >= BREAKPOINTS.chatHeaderWide };
}

/** Exposes the numbers as CSS custom properties on the shell root (app.css reads them). */
export function layoutVars(l: Layout): Record<string, string> {
  return {
    "--shell-topbar-h": `${LAYOUT.topbarH}px`,
    "--shell-header-h": `${LAYOUT.headerH}px`,
    "--shell-sidebar-w": `${l.sidebarW}px`,
    "--shell-list-w": `${l.listW}px`,
    "--shell-panel-w": `${l.panelW}px`,
    "--shell-chat-min-w": `${LAYOUT.chatMinW}px`,
    "--shell-transcript-w": `${LAYOUT.transcriptW}px`,
  };
}
