// Browser tools: the agent drives the embedded browser through the desktop node, in its own profile and tabs.
// Every call goes through the router (browser.* methods), the same door the panel uses.
import { setTimeout } from "node:timers/promises";
import { BROWSER_CAP, type TabInfo } from "@apx/protocol";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { pruneUploads, saveUpload } from "../services/uploads.ts";
import { cap, untrusted } from "./result.ts";
import { defineTool, type Tool, type ToolContext } from "./types.ts";
import { urlConfirm } from "./web.ts";

const HANDOFF_S = 300;
const SNAPSHOT_NAME = "browser-snapshot.jpg";
/** Tab pictures a chat keeps: a model call carries the newest 4 images (providers/llm.ts), older ones are dropped. */
const SNAPSHOTS_KEPT = 4;
/** Messages back a chat's own tab is looked for: past them a new tab opens. */
const CHAT_TAB_LOOKBACK = 40;

export function profileFor(agent: AgentRecord): string {
  if (agent.browser_profile === "incognito") return "incognito";
  if (agent.browser_profile === "isolated") return `agent:${agent.id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  return "shared";
}

const host = (url: unknown) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url);
  }
};

const tabArg = z.string().min(1).describe("tab id");
const refArg = z
  .string()
  .regex(/^e\d+$/)
  .describe("ref like e12, from the last snapshot");

export function browserTools(store: Store, home: string): Tool[] {
  /** The model looks at the tab itself: the tree alone misses images, charts and slides. */
  const look = async (ctx: ToolContext, tab: string) => {
    if (!ctx.see) return;
    const shot = await ctx.call("browser.screenshot", { tab }).catch(() => undefined);
    if (!shot) return;
    // A picture that cannot be kept (too big, empty, not the image it claims) leaves the tree alone.
    let m: { id: string; mime: string };
    try {
      m = saveUpload(home, store, {
        name: SNAPSHOT_NAME,
        mime: shot.mime,
        bytes: Buffer.from(shot.data, "base64"),
        thread: ctx.thread.id,
      });
    } catch {
      return;
    }
    pruneUploads(store, ctx.thread.id, SNAPSHOT_NAME, SNAPSHOTS_KEPT);
    ctx.see({ media_id: m.id, mime: m.mime });
  };
  const card = async (ctx: ToolContext, tab: string, state: "agent" | "handoff" | "user" | "done", reason?: string) => {
    const tabs = (await ctx.call("browser.tabs", {}).catch(() => ({ tabs: [] as TabInfo[] }))).tabs;
    const t = tabs.find((x) => x.tab === tab);
    ctx.upsertPart((p) => p.type === "browser" && p.tab === tab, {
      type: "browser",
      tab,
      url: t?.url ?? "",
      title: t?.title ?? "",
      state,
      ...(reason ? { reason } : {}),
    });
  };

  /** An agent only touches tabs of its own profile, and not while another agent is driving them. */
  const own = async (ctx: ToolContext, id: string): Promise<string> => {
    const t = (await ctx.call("browser.tabs", {})).tabs.find((x) => x.tab === id);
    if (!t) throw new Error(`unknown tab ${id}; open one with browser_open`);
    if (t.profile !== profileFor(ctx.agent))
      throw new Error(`tab ${id} belongs to another browser profile; open your own tab`);
    if (t.control.kind === "agent" && t.control.by !== ctx.agent.id)
      throw new Error(`tab ${id} is being used by another agent; open your own tab`);
    return id;
  };

  /** The newest tab this chat's cards show that the agent may still drive: browsing goes on there, not in a new tab. */
  const chatTab = async (ctx: ToolContext): Promise<string | undefined> => {
    const shown = store.messages
      .list(ctx.thread.id, CHAT_TAB_LOOKBACK)
      .flatMap((m) => m.parts.flatMap((p) => (p.type === "browser" ? [p.tab] : [])))
      .reverse();
    if (!shown.length) return undefined;
    const open = (await ctx.call("browser.tabs", {})).tabs;
    return shown.find((id) => {
      const t = open.find((x) => x.tab === id);
      return (
        t?.profile === profileFor(ctx.agent) &&
        (t.control.kind === "idle" || (t.control.kind === "agent" && t.control.by === ctx.agent.id))
      );
    });
  };

  return [
    defineTool({
      needsCap: BROWSER_CAP,
      name: "browser_open",
      description:
        "Open a URL in your browser: in the tab this chat already uses (or `tab`), else a new one; `new_tab` for another beside it. The owner's embedded browser when the APX app is open (they can watch it), APX's own headless one otherwise (nobody sees it, nobody can log in for you). Returns the tab id. For reading or looking something up, web_read and web_search are faster; use the browser when a page needs JavaScript, clicks or forms, or when they failed. This is your browser for any site: not the owner's screen (screen_ tools, only when they ask for their computer) nor a browser an MCP server brings (another profile, logged out, the owner cannot see it). When a page fails, retry or browser_handoff; never switch.",
      args: z.object({
        url: z.string().describe("http(s) URL"),
        tab: tabArg.optional().describe("tab id to load it in"),
        new_tab: z.boolean().optional().describe("open another tab instead of reusing this chat's"),
      }),
      effect: "external",
      confirm: (a) => urlConfirm(a.url),
      untrustedWhy: "url_data",
      deadlineMs: 30_000,
      title: (a) => `Opened ${host(a.url)}`,
      async run(a, ctx) {
        const reuse = a.tab ? await own(ctx, a.tab) : a.new_tab ? undefined : await chatTab(ctx);
        if (reuse) {
          const r = await ctx.call("browser.navigate", { tab: reuse, url: a.url, by: ctx.agent.id });
          await card(ctx, reuse, "agent");
          return `tab ${reuse} · ${r.title} · ${r.url}\nNext: browser_snapshot to see the page.`;
        }
        const t = await ctx.call("browser.open", { url: a.url, profile: profileFor(ctx.agent), by: ctx.agent.id });
        await card(ctx, t.tab, "agent");
        return `tab ${t.tab} · ${t.title} · ${t.url}\nNext: browser_snapshot to see the page.`;
      },
    }),
    defineTool({
      needsCap: BROWSER_CAP,
      name: "browser_snapshot",
      description:
        "Accessibility snapshot of a tab: interactive elements with refs (e12) for click/type, and a picture of the tab. Untrusted web content.",
      args: z.object({
        tab: tabArg,
        wait_s: z.number().int().min(1).max(10).optional().describe("seconds to wait before reading"),
      }),
      effect: "none",
      deadlineMs: 30_000,
      title: () => "Read the page",
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        if (a.wait_s) await setTimeout(a.wait_s * 1000, undefined, { signal: ctx.signal });
        const r = await ctx.call("browser.snapshot", { tab, max_chars: 12_000 });
        await look(ctx, tab);
        return untrusted("web_snapshot", { tab }, cap(r.tree));
      },
    }),
    defineTool({
      needsCap: BROWSER_CAP,
      name: "browser_text",
      description: "Visible text of the page, paginated. Use it to read content. Untrusted web content.",
      args: z.object({
        tab: tabArg,
        offset: z.number().int().min(0).optional().describe("char offset for the next page"),
      }),
      effect: "none",
      deadlineMs: 30_000,
      title: () => "Read the text",
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        const r = await ctx.call("browser.text", { tab, offset: a.offset ?? 0, max_chars: 8000 });
        const more = r.truncated ? `\n[${r.total} chars total; call again with offset]` : "";
        return `${untrusted("web_text", { source: r.url }, r.text)}${more}`;
      },
    }),
    defineTool({
      needsCap: BROWSER_CAP,
      name: "browser_click",
      description: "Click an element by ref from the last snapshot.",
      args: z.object({ tab: tabArg, ref: refArg }),
      effect: "external",
      deadlineMs: 30_000,
      title: (a) => `Clicked ${a.ref}`,
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        const r = await ctx.call("browser.click", { tab, ref: a.ref, by: ctx.agent.id });
        await card(ctx, tab, "agent");
        return `clicked ${a.ref} · now at ${r.url}. Take a new browser_snapshot to check it did what you meant.`;
      },
    }),
    defineTool({
      needsCap: BROWSER_CAP,
      name: "browser_type",
      description:
        "Type text into a field by ref. Password, 2FA and card fields are refused: use browser_handoff instead.",
      args: z.object({
        tab: tabArg,
        ref: refArg,
        text: z.string().max(10_000),
        submit: z.boolean().optional().describe("press Enter after"),
      }),
      effect: "external",
      // Typing hands data to a site: after reading a page that may be steering the agent, the owner decides.
      confirm: "untrusted",
      deadlineMs: 30_000,
      title: (a) => `Typed into ${a.ref}`,
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        const r = await ctx.call("browser.type", {
          tab,
          ref: a.ref,
          text: a.text,
          submit: a.submit ?? false,
          by: ctx.agent.id,
        });
        return `typed into ${a.ref}${a.submit ? " and pressed Enter" : ""} · ${r.url}. Take a new browser_snapshot to check it worked (a message sent, a form gone) before saying it did.`;
      },
    }),
    defineTool({
      needsCap: BROWSER_CAP,
      name: "browser_use_my_login",
      description:
        "When a site asks to log in and the owner is likely already logged in there in their own browser (Chrome, Brave, Arc, Edge, Zen, Firefox): ask to copy that site's session cookies into your browser profile, then reload the tab. It waits for the owner's OK on a card in every mode, unless they said always for you and your browser profile is the shared one. Try this before browser_handoff for sites like Gmail, GitHub or Notion.",
      args: z.object({
        domain: z
          .string()
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)
          .describe("the site's main domain, like google.com or github.com"),
      }),
      effect: "local",
      confirm: "always",
      // The owner's logins leave their browser only on their word: a grant counts only for the shared profile, which
      // every agent's profile is unless the owner chose another (DECISIONS.md#d-143).
      keepsCard: (_a, agent) => (profileFor(agent) === "shared" ? "grant" : "card"),
      deadlineMs: 150_000,
      title: (a) => `Used your session on ${String(a.domain)}`,
      async run(a, ctx) {
        const asOwner = ctx.callAsOwner;
        if (!asOwner) return "not run: the owner did not approve it";
        const profile = profileFor(ctx.agent);
        if (profile === "incognito")
          return "refused: your browser profile is incognito; ask the owner to log in instead";
        const site = a.domain.toLowerCase().replace(/^\./, "");
        // The browser where the owner has the most of this site's cookies is where they are logged in.
        let best: { source: string; browser: string; domains: string[]; count: number } | undefined;
        for (const s of (await asOwner("browser.cookie_sources", {})).sources) {
          const found = (await asOwner("browser.cookie_domains", { source: s.id, filter: site })).domains.filter(
            (d) => d.domain.replace(/^\./, "") === site || d.domain.endsWith(`.${site}`),
          );
          const count = found.reduce((n, d) => n + d.count, 0);
          if (count > (best?.count ?? 0))
            best = { source: s.id, browser: `${s.browser} (${s.profile})`, domains: found.map((d) => d.domain), count };
        }
        if (!best) return `no session for ${site} in the owner's browsers; use browser_handoff so they log in`;
        const r = await asOwner("browser.import_cookies", {
          source: best.source,
          domains: best.domains.slice(0, 50),
          profile: profile as "shared" | `agent:${string}`,
        });
        return `copied ${r.imported} cookies for ${site} from ${best.browser}. Reload the tab (browser_open with the same URL and tab) and take a new snapshot.`;
      },
    }),
    defineTool({
      needsCap: BROWSER_CAP,
      name: "browser_handoff",
      description:
        "Hand the tab to the owner and wait until they press Done (up to 5 min), then go on in it yourself: a login, password, 2FA, captcha or a site that blocks you is a handoff, not a reason to give up or go another way. Just before it, tell the owner in one line what they must do and that you take the tab back after. Never ask for passwords in chat.",
      args: z.object({ tab: tabArg, reason: z.string().max(300).describe("what the owner must do, short") }),
      effect: "none",
      deadlineMs: (HANDOFF_S + 20) * 1000,
      title: (a) => `Asked you to: ${String(a.reason).slice(0, 60)}`,
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        await card(ctx, tab, "handoff", a.reason);
        const r = await ctx.call("browser.handoff", { tab, reason: a.reason, by: ctx.agent.id, timeout_s: HANDOFF_S });
        await card(ctx, tab, r.resolved ? "agent" : "handoff", r.resolved ? undefined : "no answer");
        return r.resolved
          ? `the owner finished; tab now at ${r.url}. Take a new snapshot.`
          : "the owner did not finish in time; tell them and stop.";
      },
    }),
  ];
}
