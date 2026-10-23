// Browser commands. Defined once: operators and agent tools call them on the core, the core forwards the same
// method + params to a node that offers the "browser" capability (the desktop app), which executes them.
import { z } from "zod";

export const BROWSER_CAP = "browser";

/** shared = one persistent jar every agent reuses · incognito = in-memory, empty each run · agent:<id> = isolated. */
export const BrowserProfile = z.union([
  z.literal("shared"),
  z.literal("incognito"),
  z.string().regex(/^agent:[a-z0-9][a-z0-9-]{0,63}$/),
]);
export type BrowserProfile = z.infer<typeof BrowserProfile>;

export const TabControl = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), by: z.string(), since: z.string() }),
  z.object({ kind: z.literal("handoff"), by: z.string(), reason: z.string(), since: z.string() }),
  z.object({ kind: z.literal("user"), since: z.string() }),
  z.object({ kind: z.literal("idle") }),
]);
export type TabControl = z.infer<typeof TabControl>;

export const TabInfo = z.object({
  tab: z.string(),
  url: z.string(),
  title: z.string(),
  profile: BrowserProfile,
  control: TabControl,
});
export type TabInfo = z.infer<typeof TabInfo>;

const Tab = z.string().min(1);
const Ref = z.string().regex(/^e\d+$/);
const Url = z.string().url().max(4096);
/** Who drives the tab; shown in the pill ("Roby is using this tab"). */
const By = z.string().min(1).max(64).default("operator");

export const browserMethods = {
  "browser.tabs": {
    params: z.object({}).strict(),
    result: z.object({ tabs: z.array(TabInfo) }),
    effect: false,
  },
  "browser.open": {
    params: z.object({ url: Url, profile: BrowserProfile.default("shared"), by: By }).strict(),
    result: TabInfo,
    effect: true,
  },
  "browser.navigate": {
    params: z.object({ tab: Tab, url: Url, by: By }).strict(),
    result: z.object({ url: z.string(), title: z.string() }),
    effect: true,
  },
  "browser.history": {
    params: z.object({ tab: Tab, action: z.enum(["back", "forward", "reload"]), by: By }).strict(),
    result: z.object({ url: z.string(), title: z.string() }),
    effect: true,
  },
  "browser.snapshot": {
    params: z.object({ tab: Tab, max_chars: z.number().int().min(500).max(100_000).default(20_000) }).strict(),
    /** `tree` is untrusted web content, already wrapped as such by the node. */
    result: z.object({
      url: z.string(),
      title: z.string(),
      tree: z.string(),
      refs: z.number().int(),
      truncated: z.boolean(),
    }),
    effect: false,
  },
  "browser.click": {
    params: z.object({ tab: Tab, ref: Ref, by: By }).strict(),
    result: z.object({ ok: z.literal(true), url: z.string() }),
    effect: true,
  },
  "browser.type": {
    params: z
      .object({ tab: Tab, ref: Ref, text: z.string().max(10_000), submit: z.boolean().default(false), by: By })
      .strict(),
    result: z.object({ ok: z.literal(true), url: z.string() }),
    effect: true,
  },
  "browser.screenshot": {
    params: z.object({ tab: Tab }).strict(),
    result: z.object({ mime: z.literal("image/jpeg"), data: z.string(), bytes: z.number().int() }),
    effect: false,
  },
  /** The human's hand from any operator: take the tab, give it back, or finish a handoff. */
  "browser.control": {
    params: z.object({ tab: Tab, mode: z.enum(["user", "idle", "done"]) }).strict(),
    result: TabInfo,
    effect: true,
    access: "human",
  },
  /** The agent hands the tab to the human (login, 2FA, captcha) and waits until they finish or the deadline passes. */
  "browser.handoff": {
    params: z
      .object({
        tab: Tab,
        reason: z.string().max(300),
        by: By,
        timeout_s: z.number().int().min(10).max(900).default(300),
      })
      .strict(),
    result: z.object({ resolved: z.boolean(), url: z.string(), title: z.string() }),
    effect: true,
  },
  /** Visible text of the page, paginated. Untrusted web content. */
  "browser.text": {
    params: z
      .object({
        tab: Tab,
        offset: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(200).max(50_000).default(8_000),
      })
      .strict(),
    result: z.object({ url: z.string(), text: z.string(), total: z.number().int(), truncated: z.boolean() }),
    effect: false,
  },
  /** Browsers whose sessions can be imported (detected on the desktop). Human-only. */
  "browser.cookie_sources": {
    params: z.object({}).strict(),
    result: z.object({
      sources: z.array(
        z.object({ id: z.string(), browser: z.string(), profile: z.string(), family: z.enum(["firefox", "chromium"]) }),
      ),
    }),
    effect: false,
    access: "human",
  },
  /** Domains with cookies in a source, with counts only — never values. */
  "browser.cookie_domains": {
    params: z.object({ source: z.string(), filter: z.string().max(100).default("") }).strict(),
    result: z.object({ domains: z.array(z.object({ domain: z.string(), count: z.number().int() })) }),
    effect: false,
    access: "human",
  },
  /** Copies the chosen domains' cookies into an APX profile. Values stay on the desktop. Human-only. */
  "browser.import_cookies": {
    params: z
      .object({
        source: z.string(),
        domains: z.array(z.string().max(253)).min(1).max(50),
        profile: z.union([z.literal("shared"), z.string().regex(/^agent:[a-z0-9][a-z0-9-]{0,63}$/)]).default("shared"),
      })
      .strict(),
    result: z.object({ imported: z.number().int(), skipped: z.number().int(), failed: z.number().int() }),
    effect: true,
    access: "human",
  },
  "browser.close": {
    params: z.object({ tab: Tab }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
  },
} as const;

export type BrowserMethod = keyof typeof browserMethods;
export const BROWSER_METHODS = Object.keys(browserMethods) as BrowserMethod[];

/**
 * Core → browser only, never a client method: the tabs a running turn holds. A held tab is not closed for being idle;
 * an empty list (the turn ended) lets them go.
 */
export const BROWSER_HOLD = "browser.hold";
export const BrowserHold = z.object({ run: z.string().min(1).max(128), tabs: z.array(Tab).max(64) }).strict();

/**
 * The browser's side of browser.hold: which tabs a running turn still holds. `onRelease` hears each tab no turn holds
 * any more, so an agent's tab shows as free once its turn ends.
 */
export function createTabHolds(onRelease?: (tab: string) => void) {
  const runs = new Map<string, Set<string>>();
  const held = (tab: string): boolean => [...runs.values()].some((tabs) => tabs.has(tab));
  return {
    set(raw: unknown): { ok: true } {
      const p = BrowserHold.parse(raw);
      const before = runs.get(p.run) ?? new Set<string>();
      if (p.tabs.length) runs.set(p.run, new Set(p.tabs));
      else runs.delete(p.run);
      for (const tab of before) if (!held(tab)) onRelease?.(tab);
      return { ok: true };
    },
    held,
    /** The link to the core dropped: a core that comes back tells its holds again. */
    clear: (): void => runs.clear(),
  };
}
