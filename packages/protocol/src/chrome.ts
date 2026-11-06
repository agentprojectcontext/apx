// The owner's own Chrome as a browser node: APX's extension drives tabs in its "APX" group through Chrome's debugger,
// and `apx chrome-host` (started by Chrome over native messaging) lends them to the core. See DECISIONS.md#d-198
import { z } from "zod";

/** The capability the Chrome node lends: browser.* methods on the owner's Chrome, apart from APX's own browser. */
export const CHROME_CAP = "chrome";
/** The Chrome Web Store item; an unpacked build carries the store's key, so both have this ID. */
export const CHROME_EXTENSION_ID = "jiffjibeffjmombaholpgbnfdajpfigm";
/** What Chrome passes a native host as the caller, and the only origin its manifest allows. */
export const CHROME_EXTENSION_ORIGIN = `chrome-extension://${CHROME_EXTENSION_ID}/`;
/** The native messaging host's name, as the extension asks for it and APX registers it. */
export const CHROME_HOST = "dev.apx.chrome";
/** A message's `via` when it was written in, or answered to, APX's panel in Chrome (not a channel's id). */
export const CHROME_VIA = "chrome";
/** APX's tab ids for Chrome tabs: `c` and Chrome's own number. */
export const chromeTab = (id: number) => `c${id}`;
export const chromeTabId = (tab: string): number | undefined => {
  const m = /^c(\d{1,10})$/.exec(tab);
  return m ? Number(m[1]) : undefined;
};

const Id = z.string().min(1).max(64);
const TabId = z.number().int().nonnegative();

/** What the host asks the extension; each gets one `res` with the same id. */
export const ChromeRequest = z.discriminatedUnion("t", [
  /** One DevTools command to a tab of the APX group (the extension attaches its debugger on first use). */
  z.object({
    t: z.literal("cdp"),
    id: Id,
    tab: TabId,
    method: z.string().min(1).max(100),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  /** A new tab in the APX group, blank: the host loads the address through the same guard as every load. */
  z.object({ t: z.literal("open"), id: Id }),
  z.object({ t: z.literal("close"), id: Id, tab: TabId }),
  /** The tabs of the APX group: the only ones the agent sees. */
  z.object({ t: z.literal("list"), id: Id }),
  /** Brings a tab to the front (a picture of a hidden tab comes out blank). */
  z.object({ t: z.literal("show"), id: Id, tab: TabId }),
]);
export type ChromeRequest = z.infer<typeof ChromeRequest>;

export const ChromeTabRow = z.object({ tab: TabId, url: z.string(), title: z.string() });
export type ChromeTabRow = z.infer<typeof ChromeTabRow>;

/** What the extension sends the host: answers, the tabs' DevTools events, and changes to the group. */
export const ChromeMessage = z.discriminatedUnion("t", [
  /** `result` when it went, `error` (Chrome's words) when not. */
  z.object({
    t: z.literal("res"),
    id: Id,
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().max(2000).optional(),
  }),
  z.object({
    t: z.literal("event"),
    tab: TabId,
    method: z.string().max(100),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  /** The debugger left a tab: `canceled_by_user` is the owner pressing Cancel on Chrome's bar. */
  z.object({ t: z.literal("detached"), tab: TabId, reason: z.string().max(100) }),
  /** A tab joined, left or closed in the APX group. */
  z.object({ t: z.literal("tabs") }),
]);
export type ChromeMessage = z.infer<typeof ChromeMessage>;
