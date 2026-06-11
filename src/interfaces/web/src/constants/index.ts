// Centralised constants. Nothing in src/components or src/screens should
// hard-code a route, a poll interval, or a magic number — they import from
// here. Adding a new tunable? Put it here first.

export const DAEMON = {
  /** Localhost daemon URL — used when the SPA is opened on the same host. */
  defaultPort: 7430,
} as const;

/** SWR refresh intervals (ms). Tuned for "feels live" without thrashing. */
export const REFRESH = {
  health: 5_000,
  projects: 15_000,
  telegramStatus: 8_000,
  routines: 10_000,
  pairList: 12_000,
} as const;

/** Local-storage keys. */
export const STORAGE = {
  theme: "apx.theme",
  token: "apx.token",
  sidebarCollapsed: "apx.sidebar.collapsed",
  language: "apx.lang",
  robyChat: "apx.roby.chat",
} as const;

/** Tailwind class tokens reused across components. */
export const UI = {
  cardClass: "rounded-xl border border-border bg-card",
  inputClass:
    "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring",
  sectionTitleClass: "text-lg font-semibold tracking-tight",
} as const;

/** Auth bypass — the SPA reads `#token=<hex>` on first paint. */
export const URL_TOKEN_FRAGMENT_KEY = "token";

/** Default polling for chat — used when stream falls back. */
export const CHAT = {
  maxBufferChars: 200_000,
} as const;

/** Engine ids the web knows about. The daemon's /engines returns the truth;
 *  this is the order we present them in dropdowns. */
export const ENGINE_ORDER = [
  "anthropic",
  "openai",
  "gemini",
  "groq",
  "openrouter",
  "ollama",
  "mock",
] as const;

/** Permission modes accepted by the super-agent. Must match
 *  src/core/agent/permission-modes.js on the daemon. */
export const PERMISSION_MODES = ["total", "automatico", "permiso"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Routine kinds — must match src/core/routines/runner.js. */
export const ROUTINE_KINDS = [
  "heartbeat",
  "exec_agent",
  "super_agent",
  "telegram",
  "shell",
] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];

/** Project icon palette — used by Sidebar avatars. */
export const PROJECT_TONES = ["sky", "violet", "emerald", "amber", "rose", "indigo", "teal", "fuchsia"] as const;
export type ProjectTone = (typeof PROJECT_TONES)[number];

/** Brand assets served from /public/logo and /public/favicon. */
export const LOGO = {
  icon: {
    light: "/logo/logo_only_white.webp",
    dark: "/logo/logo_only_dark.webp",
  },
  full: {
    light: "/logo/logo_white.webp",
    dark: "/logo/logo_dark.webp",
  },
  vertical: {
    light: "/logo/logo_vertical_white.webp",
    dark: "/logo/logo_vertical_dark.webp",
  },
} as const;

export type LogoVariant = keyof typeof LOGO;
