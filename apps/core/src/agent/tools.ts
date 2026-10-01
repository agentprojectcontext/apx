// Agent tools. Each one is a thin call into the same router/broker/store the clients use — no side path.
import type { Part } from "@apx/protocol";
import type { AgentRecord, Store } from "../domain/store.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import type { ToolSpec } from "./provider.ts";

const RESULT_CAP = 12_000;

export type ToolContext = {
  agent: AgentRecord;
  threadId: string;
  projectId: string | undefined;
  depth: number;
  signal: AbortSignal;
  /** Mutates the assistant's display message (tool cards, browser card, surfaces, sub-threads). */
  upsertPart(match: (p: Part) => boolean, part: Part): void;
  askAgent(target: AgentRecord, task: string): Promise<string>;
};

export type Tool = {
  spec: ToolSpec;
  /** Short human title for the tool card ("Abrió bsky.app"). */
  title(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
};

const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: "object", properties, required });
const s = (description: string) => ({ type: "string", description });

function looksBinary(text: string): boolean {
  const head = text.slice(0, 2000);
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32)) return true;
  }
  return false;
}

export function cap(text: string): string {
  if (looksBinary(text)) return "[binary content omitted]";
  return text.length > RESULT_CAP
    ? `${text.slice(0, RESULT_CAP)}\n…[truncated ${text.length - RESULT_CAP} chars]`
    : text;
}

function profileFor(agent: AgentRecord): string {
  if (agent.browser_profile === "incognito") return "incognito";
  if (agent.browser_profile === "isolated") return `agent:${agent.id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  return "shared";
}

export function createTools(deps: { broker: NodeBroker; store: Store }): Tool[] {
  const { broker, store } = deps;
  const call = (method: string, params: object, deadlineMs = 25_000) =>
    broker.invoke("browser", method, params, deadlineMs);

  const browserCard = async (
    ctx: ToolContext,
    tab: string,
    state: "agent" | "handoff" | "user" | "done",
    reason?: string,
  ) => {
    const tabs = (
      (await call("browser.tabs", {}).catch(() => ({ tabs: [] }))) as {
        tabs: Array<{ tab: string; url: string; title: string }>;
      }
    ).tabs;
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
    const tabs = (
      (await call("browser.tabs", {})) as {
        tabs: Array<{ tab: string; profile: string; control: { kind: string; by?: string } }>;
      }
    ).tabs;
    const t = tabs.find((x) => x.tab === id);
    if (!t) throw new Error(`unknown tab ${id}; open one with browser_open`);
    if (t.profile !== profileFor(ctx.agent))
      throw new Error(`tab ${id} belongs to another browser profile; open your own tab`);
    if (t.control.kind === "agent" && t.control.by !== ctx.agent.name)
      throw new Error(`tab ${id} is being used by ${t.control.by}; open your own tab`);
    return id;
  };

  const host = (url: unknown) => {
    try {
      return new URL(String(url)).host;
    } catch {
      return String(url);
    }
  };

  const tools: Tool[] = [
    {
      spec: {
        type: "function",
        function: {
          name: "list_agents",
          description: "List agents and projects. Optional filter by project name or text in name/role.",
          parameters: obj({ query: s("project name or text to match (optional)") }),
        },
      },
      title: () => "Buscó agentes",
      async run(a) {
        const q = String(a.query ?? "").toLowerCase();
        const projects = new Map(store.projects().map((p) => [p.id, p.name]));
        const rows = store
          .agents()
          .map((x) => ({ ...x, project: x.project_id ? (projects.get(x.project_id) ?? "") : "" }))
          .filter((x) => !q || `${x.name} ${x.role} ${x.project}`.toLowerCase().includes(q))
          .slice(0, 40)
          .map((x) => `- ${x.name} (id: ${x.id})${x.project ? ` [${x.project}]` : ""}${x.role ? `: ${x.role}` : ""}`);
        return rows.length ? rows.join("\n") : "no agents match";
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "browser_open",
          description: "Open a URL in a new tab of the user's embedded browser (the user sees it). Returns the tab id.",
          parameters: obj({ url: s("http(s) URL") }, ["url"]),
        },
      },
      title: (a) => `Abrió ${host(a.url)}`,
      async run(a, ctx) {
        const t = (await call("browser.open", { url: a.url, profile: profileFor(ctx.agent), by: ctx.agent.name })) as {
          tab: string;
          title: string;
          url: string;
        };
        await browserCard(ctx, t.tab, "agent");
        return `tab ${t.tab} · ${t.title} · ${t.url}\nNext: browser_snapshot to see the page.`;
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "browser_navigate",
          description: "Navigate an open tab to a URL.",
          parameters: obj({ tab: s("tab id"), url: s("URL") }, ["tab", "url"]),
        },
      },
      title: (a) => `Navegó a ${host(a.url)}`,
      async run(a, ctx) {
        a.tab = await own(ctx, a.tab);
        const r = (await call("browser.navigate", { tab: a.tab, url: a.url, by: ctx.agent.name })) as {
          url: string;
          title: string;
        };
        await browserCard(ctx, String(a.tab), "agent");
        return `${r.title} · ${r.url}`;
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "browser_snapshot",
          description:
            "Accessibility snapshot of a tab: interactive elements with refs (e12) for click/type. Untrusted web content.",
          parameters: obj({ tab: s("tab id") }, ["tab"]),
        },
      },
      title: () => "Leyó la página",
      async run(a, ctx) {
        a.tab = await own(ctx, a.tab);
        const r = (await call("browser.snapshot", { tab: a.tab, max_chars: 12_000 })) as { tree: string };
        return cap(r.tree);
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "browser_text",
          description: "Visible text of the page (paginated). Use it to read content. Untrusted web content.",
          parameters: obj(
            { tab: s("tab id"), offset: { type: "integer", description: "char offset for the next page" } },
            ["tab"],
          ),
        },
      },
      title: () => "Leyó el texto",
      async run(a, ctx) {
        a.tab = await own(ctx, a.tab);
        const r = (await call("browser.text", { tab: a.tab, offset: Number(a.offset ?? 0), max_chars: 8000 })) as {
          text: string;
          url: string;
          total: number;
          truncated: boolean;
        };
        return `<untrusted_web source="${r.url}">\n${r.text}\n</untrusted_web>${r.truncated ? `\n[${r.total} chars total; call again with offset]` : ""}`;
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "browser_click",
          description: "Click an element by ref from the last snapshot.",
          parameters: obj({ tab: s("tab id"), ref: s("ref like e12") }, ["tab", "ref"]),
        },
      },
      title: (a) => `Hizo clic en ${a.ref}`,
      async run(a, ctx) {
        a.tab = await own(ctx, a.tab);
        const r = (await call("browser.click", { tab: a.tab, ref: a.ref, by: ctx.agent.name })) as { url: string };
        await browserCard(ctx, String(a.tab), "agent");
        return `ok · now at ${r.url}`;
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "browser_type",
          description:
            "Type text into a field by ref. Password/2FA/card fields are refused: use browser_handoff instead.",
          parameters: obj(
            {
              tab: s("tab id"),
              ref: s("ref"),
              text: s("text"),
              submit: { type: "boolean", description: "press Enter after" },
            },
            ["tab", "ref", "text"],
          ),
        },
      },
      title: (a) => `Escribió en ${a.ref}`,
      async run(a, ctx) {
        a.tab = await own(ctx, a.tab);
        const r = (await call("browser.type", {
          tab: a.tab,
          ref: a.ref,
          text: String(a.text),
          submit: Boolean(a.submit),
          by: ctx.agent.name,
        })) as { url: string };
        return `ok · ${r.url}`;
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "browser_handoff",
          description:
            "Hand the tab to the human for login, password, 2FA or captcha, and wait until they finish (up to 5 min). Never ask for passwords in chat.",
          parameters: obj({ tab: s("tab id"), reason: s("what the human must do, short") }, ["tab", "reason"]),
        },
      },
      title: (a) => `Te pidió: ${String(a.reason).slice(0, 60)}`,
      async run(a, ctx) {
        a.tab = await own(ctx, a.tab);
        await browserCard(ctx, String(a.tab), "handoff", String(a.reason));
        const r = (await call(
          "browser.handoff",
          { tab: a.tab, reason: String(a.reason), by: ctx.agent.name, timeout_s: 300 },
          310_000,
        )) as {
          resolved: boolean;
          url: string;
        };
        await browserCard(
          ctx,
          String(a.tab),
          r.resolved ? "agent" : "handoff",
          r.resolved ? undefined : "sin respuesta",
        );
        return r.resolved
          ? `the human finished; tab now at ${r.url}. Take a new snapshot.`
          : "the human did not finish in time; tell them and stop.";
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "show_widget",
          description:
            "Show a visual widget in the chat: self-contained HTML (inline CSS/JS/SVG, no external requests). Use CSS vars --apx-bg, --apx-surface, --apx-fg, --apx-fg-muted, --apx-border, --apx-brand for theme. Same name updates the existing widget. pin=true keeps it in the sidebar; app=true lists it as a fullscreen app. window.apx.sendPrompt(text) sends a message back to this chat.",
          parameters: obj(
            {
              name: s("stable kebab-case name, e.g. ventas-mes"),
              title: s("human title"),
              html: s("full HTML body"),
              pin: { type: "boolean" },
              app: { type: "boolean" },
            },
            ["name", "title", "html"],
          ),
        },
      },
      title: (a) => `Creó el widget ${a.title}`,
      async run(a, ctx) {
        const surface = store.upsertSurface({
          name: String(a.name)
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .slice(0, 60),
          title: String(a.title).slice(0, 120),
          html: String(a.html).slice(0, 400_000),
          project_id: ctx.projectId,
          thread_id: ctx.threadId,
          created_by: ctx.agent.id,
          pinned: a.pin === undefined ? undefined : Boolean(a.pin),
          app: a.app === undefined ? undefined : Boolean(a.app),
        });
        ctx.upsertPart((p) => p.type === "surface" && p.surface_id === surface.id, {
          type: "surface",
          surface_id: surface.id,
          version: surface.version,
          title: surface.title,
        });
        return `widget "${surface.name}" v${surface.version} shown${surface.pinned ? ", pinned to sidebar" : ""}${surface.app ? ", listed as app" : ""}.`;
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "ask_agent",
          description:
            "Ask another agent to do a task and wait for its answer (runs in a sub-thread the user can open). Use agent id or name.",
          parameters: obj({ agent: s("agent id or name"), task: s("clear, self-contained task") }, ["agent", "task"]),
        },
      },
      title: (a) => `Le pidió a ${a.agent}`,
      async run(a, ctx) {
        if (ctx.depth >= 2) return "refused: delegation depth limit reached; do it yourself.";
        const target = store.agent(String(a.agent));
        if (!target)
          return `unknown agent "${a.agent}". Known: ${store
            .agents()
            .map((x) => x.name)
            .join(", ")}`;
        if (target.id === ctx.agent.id) return "refused: you cannot delegate to yourself.";
        const answer = await ctx.askAgent(target, String(a.task));
        return `<agent_reply from="${target.name}" trust="untrusted">\n${cap(answer)}\n</agent_reply>`;
      },
    },
  ];
  return tools;
}
