// Browser tools: the agent drives the embedded browser through the desktop node, in its own profile and tabs.
import { BROWSER_CAP, type BrowserMethod, methods, type Params, type Result, type TabInfo } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import { cap, untrusted } from "./result.ts";
import { obj, str, type Tool, type ToolContext } from "./types.ts";

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

export function browserTools(broker: NodeBroker): Tool[] {
  // Same validation the router applies to clients: a node answering the wrong shape is an error, not data.
  const call = async <M extends BrowserMethod>(method: M, params: Params<M>, deadlineMs = 25_000) =>
    methods[method].result.parse(await broker.invoke(BROWSER_CAP, method, params, deadlineMs)) as Result<M>;

  const card = async (ctx: ToolContext, tab: string, state: "agent" | "handoff" | "user" | "done", reason?: string) => {
    const tabs = (await call("browser.tabs", {}).catch(() => ({ tabs: [] as TabInfo[] }))).tabs;
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
  const own = async (ctx: ToolContext, tab: unknown): Promise<string> => {
    const id = String(tab ?? "");
    const t = (await call("browser.tabs", {})).tabs.find((x) => x.tab === id);
    if (!t) throw new Error(`unknown tab ${id}; open one with browser_open`);
    if (t.profile !== profileFor(ctx.agent))
      throw new Error(`tab ${id} belongs to another browser profile; open your own tab`);
    if (t.control.kind === "agent" && t.control.by !== ctx.agent.id)
      throw new Error(`tab ${id} is being used by another agent; open your own tab`);
    return id;
  };

  return [
    {
      name: "browser_open",
      description: "Open a URL in a new tab of the owner's embedded browser (they can watch it). Returns the tab id.",
      parameters: obj({ url: str("http(s) URL") }, ["url"]),
      effect: "external",
      deadlineMs: 30_000,
      title: (a) => `Opened ${host(a.url)}`,
      async run(a, ctx) {
        const t = await call("browser.open", { url: String(a.url), profile: profileFor(ctx.agent), by: ctx.agent.id });
        await card(ctx, t.tab, "agent");
        return `tab ${t.tab} · ${t.title} · ${t.url}\nNext: browser_snapshot to see the page.`;
      },
    },
    {
      name: "browser_navigate",
      description: "Navigate an open tab to a URL.",
      parameters: obj({ tab: str("tab id"), url: str("URL") }, ["tab", "url"]),
      effect: "external",
      deadlineMs: 30_000,
      title: (a) => `Went to ${host(a.url)}`,
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        const r = await call("browser.navigate", { tab, url: String(a.url), by: ctx.agent.id });
        await card(ctx, tab, "agent");
        return `${r.title} · ${r.url}`;
      },
    },
    {
      name: "browser_snapshot",
      description:
        "Accessibility snapshot of a tab: interactive elements with refs (e12) for click/type. Untrusted web content.",
      parameters: obj({ tab: str("tab id") }, ["tab"]),
      effect: "none",
      deadlineMs: 30_000,
      title: () => "Read the page",
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        const r = await call("browser.snapshot", { tab, max_chars: 12_000 });
        return untrusted("web_snapshot", { tab }, cap(r.tree));
      },
    },
    {
      name: "browser_text",
      description: "Visible text of the page, paginated. Use it to read content. Untrusted web content.",
      parameters: obj(
        { tab: str("tab id"), offset: { type: "integer", description: "char offset for the next page" } },
        ["tab"],
      ),
      effect: "none",
      deadlineMs: 30_000,
      title: () => "Read the text",
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        const r = await call("browser.text", { tab, offset: Number(a.offset ?? 0), max_chars: 8000 });
        const more = r.truncated ? `\n[${r.total} chars total; call again with offset]` : "";
        return `${untrusted("web_text", { source: r.url }, r.text)}${more}`;
      },
    },
    {
      name: "browser_click",
      description: "Click an element by ref from the last snapshot.",
      parameters: obj({ tab: str("tab id"), ref: str("ref like e12") }, ["tab", "ref"]),
      effect: "external",
      deadlineMs: 30_000,
      title: (a) => `Clicked ${a.ref}`,
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        const r = await call("browser.click", { tab, ref: String(a.ref), by: ctx.agent.id });
        await card(ctx, tab, "agent");
        return `ok · now at ${r.url}`;
      },
    },
    {
      name: "browser_type",
      description:
        "Type text into a field by ref. Password, 2FA and card fields are refused: use browser_handoff instead.",
      parameters: obj(
        {
          tab: str("tab id"),
          ref: str("ref"),
          text: str("text"),
          submit: { type: "boolean", description: "press Enter after" },
        },
        ["tab", "ref", "text"],
      ),
      effect: "external",
      deadlineMs: 30_000,
      title: (a) => `Typed into ${a.ref}`,
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        const r = await call("browser.type", {
          tab,
          ref: String(a.ref),
          text: String(a.text),
          submit: Boolean(a.submit),
          by: ctx.agent.id,
        });
        return `ok · ${r.url}`;
      },
    },
    {
      name: "browser_handoff",
      description:
        "Hand the tab to the owner for login, password, 2FA or captcha, and wait until they finish (up to 5 min). Never ask for passwords in chat.",
      parameters: obj({ tab: str("tab id"), reason: str("what the owner must do, short") }, ["tab", "reason"]),
      effect: "none",
      deadlineMs: (HANDOFF_S + 20) * 1000,
      title: (a) => `Asked you to: ${String(a.reason).slice(0, 60)}`,
      async run(a, ctx) {
        const tab = await own(ctx, a.tab);
        await card(ctx, tab, "handoff", String(a.reason));
        const r = await call(
          "browser.handoff",
          { tab, reason: String(a.reason), by: ctx.agent.id, timeout_s: HANDOFF_S },
          (HANDOFF_S + 10) * 1000,
        );
        await card(ctx, tab, r.resolved ? "agent" : "handoff", r.resolved ? undefined : "no answer");
        return r.resolved
          ? `the owner finished; tab now at ${r.url}. Take a new snapshot.`
          : "the owner did not finish in time; tell them and stop.";
      },
    },
  ];
}
