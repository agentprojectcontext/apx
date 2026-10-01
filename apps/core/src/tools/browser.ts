// Browser tools: the agent drives the embedded browser through the desktop node, in its own profile and tabs.
// Every call goes through the router (browser.* methods), the same door the panel uses.
import type { TabInfo } from "@apx/protocol";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import { cap, untrusted } from "./result.ts";
import { defineTool, type Tool, type ToolContext } from "./types.ts";

const HANDOFF_S = 300;

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

export function browserTools(): Tool[] {
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

  return [
    defineTool({
      name: "browser_open",
      description: "Open a URL in a new tab of the owner's embedded browser (they can watch it). Returns the tab id.",
      args: z.object({ url: z.string().describe("http(s) URL") }),
      effect: "external",
      deadlineMs: 30_000,
      title: (a) => `Opened ${host(a.url)}`,
      async run(a, ctx) {
        const t = await ctx.call("browser.open", { url: a.url, profile: profileFor(ctx.agent), by: ctx.agent.id });
        await card(ctx, t.tab, "agent");
        return `tab ${t.tab} · ${t.title} · ${t.url}\nNext: browser_snapshot to see the page.`;
      },
    }),
    defineTool({
      name: "browser_navigate",
      description: "Navigate an open tab to a URL.",
      args: z.object({ tab: tabArg, url: z.string().describe("URL") }),
      effect: "external",
      deadlineMs: 30_000,
      title: (a) => `Went to ${host(a.url)}`,
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        const r = await ctx.call("browser.navigate", { tab, url: a.url, by: ctx.agent.id });
        await card(ctx, tab, "agent");
        return `${r.title} · ${r.url}`;
      },
    }),
    defineTool({
      name: "browser_snapshot",
      description:
        "Accessibility snapshot of a tab: interactive elements with refs (e12) for click/type. Untrusted web content.",
      args: z.object({ tab: tabArg }),
      effect: "none",
      deadlineMs: 30_000,
      title: () => "Read the page",
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        const r = await ctx.call("browser.snapshot", { tab, max_chars: 12_000 });
        return untrusted("web_snapshot", { tab }, cap(r.tree));
      },
    }),
    defineTool({
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
        return `ok · now at ${r.url}`;
      },
    }),
    defineTool({
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
        return `ok · ${r.url}`;
      },
    }),
    defineTool({
      name: "browser_handoff",
      description:
        "Hand the tab to the owner for login, password, 2FA or captcha, and wait until they finish (up to 5 min). Never ask for passwords in chat.",
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
