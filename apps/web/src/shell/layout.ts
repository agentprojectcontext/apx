// Every layout number of the shell lives here so a re-skin touches one file. See plan/design/SPEC.md §1.3.

export const LAYOUT = {
  topbarH: 46,
  /** Chat, panel and app headers. */
  headerH: 56,
  sidebarW: 236,
  sidebarRailW: 60,
  /** What the owner may drag the sidebar and the chat list to. */
  sidebarMinW: 200,
  sidebarMaxW: 380,
  listMinW: 240,
  listMaxW: 520,
  /** A folded chat list leaves this strip to open it again. */
  listW: 320,
  listWNarrow: 280,
  panelW: 420,
  panelWNarrow: 360,
  /** What the owner may drag the side panel down to (up to whatever leaves the chat its minimum). */
  panelMinW: 320,
  chatMinW: 360,
  /** Transcript + composer max width per Settings › Appearance (narrow · medium · wide). */
  transcriptW: { narrow: 640, medium: 760, wide: 980 },
  /** Config modal (overlay padding 32). */
  configW: 1080,
  configH: 760,
  configNavW: 240,
  /** Project screens: content max widths. */
  projectMaxW: 1080,
  teamMaxW: 1180,
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
  /** Below this width the chat workspace shows one column at a time: the list, the chat or the side panel. */
  compact: 640,
} as const;

export type Layout = {
  sidebarW: number;
  transcriptW: number;
  rail: boolean;
  listW: number;
  panelW: number;
  /** How wide the owner may drag the side panel. */
  panelMaxW: number;
  /** Chat header shows inline panel icons (true) or one dropdown (false). */
  wideHeader: boolean;
  /** One column at a time (phone width): the chat header gets a back button to the list. */
  compact: boolean;
};

/** Column widths for a viewport width, following the design's breakpoints. */
export function computeLayout(
  width: number,
  panelOpen: boolean,
  chatShown: boolean,
  transcript: keyof typeof LAYOUT.transcriptW = "medium",
  own: { sidebarW?: number; sidebarCollapsed?: boolean; listW?: number; panelW?: number; panelWide?: boolean } = {},
): Layout {
  const rail = Boolean(own.sidebarCollapsed) || width < BREAKPOINTS.sidebarFull;
  const compact = width < BREAKPOINTS.compact;
  const narrow = width < BREAKPOINTS.panelWide;
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const sidebarW = rail
    ? LAYOUT.sidebarRailW
    : own.sidebarW
      ? clamp(own.sidebarW, LAYOUT.sidebarMinW, LAYOUT.sidebarMaxW)
      : LAYOUT.sidebarW;
  const panelMaxW = Math.max(LAYOUT.panelMinW, width - sidebarW - LAYOUT.chatMinW);
  // Wide: half of what the list leaves (it hides), never under the usual width. A dragged width wins over both.
  const panelW = compact
    ? width - sidebarW
    : own.panelWide
      ? Math.max(LAYOUT.panelW, Math.min(Math.round((width - sidebarW) / 2), width - sidebarW - LAYOUT.chatMinW))
      : own.panelW
        ? clamp(own.panelW, LAYOUT.panelMinW, panelMaxW)
        : narrow
          ? LAYOUT.panelWNarrow
          : LAYOUT.panelW;
  const ownListW = own.listW ? clamp(own.listW, LAYOUT.listMinW, LAYOUT.listMaxW) : 0;
  const defaultListW = width >= BREAKPOINTS.listWide ? LAYOUT.listW : LAYOUT.listWNarrow;
  // A panel dragged wide enough to squeeze the chat under its minimum folds the list away, like the wide toggle.
  const crowded = width - sidebarW - panelW - (ownListW || defaultListW) < LAYOUT.chatMinW;
  const hideList = (narrow || Boolean(own.panelWide) || (Boolean(own.panelW) && crowded)) && panelOpen && chatShown;
  const listW = compact ? width - sidebarW : hideList ? 0 : ownListW || defaultListW;
  const chatW = width - sidebarW - listW - (panelOpen ? panelW : 0);
  return {
    rail,
    sidebarW,
    transcriptW: LAYOUT.transcriptW[transcript],
    listW,
    panelW,
    panelMaxW,
    wideHeader: !compact && chatW >= BREAKPOINTS.chatHeaderWide,
    compact,
  };
}

/** Exposes the numbers as CSS custom properties on the shell root (app.css reads them). */
export function layoutVars(l: Layout): Record<string, string> {
  return {
    "--shell-topbar-h": `${LAYOUT.topbarH}px`,
    "--shell-header-h": `${LAYOUT.headerH}px`,
    "--shell-sidebar-w": `${l.sidebarW}px`,
    "--shell-list-w": `${l.listW}px`,
    "--shell-panel-w": `${l.panelW}px`,
    "--shell-chat-min-w": l.compact ? "0px" : `${LAYOUT.chatMinW}px`,
    "--shell-transcript-w": `${l.transcriptW}px`,
    "--shell-project-max-w": `${LAYOUT.projectMaxW}px`,
    "--shell-team-max-w": `${LAYOUT.teamMaxW}px`,
  };
}
