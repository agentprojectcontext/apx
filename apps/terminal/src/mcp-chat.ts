// Chat tools for an outside app connected with a client token (`APX_CLIENT_TOKEN`): list APX's agents, ask one and
// wait for the answer, read a chat it started. The core decides what the token allows; nothing is checked here.
import { type ApxClient, ApxError } from "@apx/protocol/client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const WAIT_MS = 5 * 60_000;
const POLL_MS = 1500;

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: t }], isError });
const failed = (err: unknown) => text(err instanceof ApxError ? `${err.code}: ${err.message}` : String(err), true);

/** The words of a run's answer, once it ended (or why it has not). */
async function answerOf(client: ApxClient, thread: string, runId: string, until: number): Promise<string> {
  for (;;) {
    const r = await client.call("threads.get", { thread });
    const run = r.runs.find((x) => x.id === runId);
    if (run && ["completed", "failed", "canceled"].includes(run.state)) {
      const msg = r.messages.filter((m) => m.run_id === runId && m.author.kind === "agent").at(-1);
      const words = (msg?.parts ?? []).flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
      return run.state === "completed" ? words || "(no answer)" : `The run ${run.state}: ${run.error ?? ""}`;
    }
    if (run?.state === "input-required") return `Waiting for the owner to approve something in APX (thread ${thread}).`;
    if (Date.now() > until) return `Still working; read it later with apx_read (thread ${thread}).`;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export function registerChatTools(server: McpServer, client: ApxClient): void {
  server.registerTool(
    "apx_agents",
    { description: "List the agents in APX (id, name, role, project) you can ask with apx_ask.", inputSchema: {} },
    async () => {
      try {
        const { agents } = await client.call("agents.list", {});
        return text(
          agents
            .map(
              (a) =>
                `- ${a.id}: ${a.name}${a.role ? ` — ${a.role}` : ""}${a.project_id ? ` (project ${a.project_id})` : ""}`,
            )
            .join("\n") || "no agents",
        );
      } catch (err) {
        return failed(err);
      }
    },
  );
  server.registerTool(
    "apx_ask",
    {
      description:
        "Ask an APX agent something and wait for its answer (up to 5 minutes). Pass `thread` to continue a chat you started; otherwise a new one starts. The agent treats your text as a request from another app, not as its owner's order.",
      inputSchema: {
        agent: z.string().describe("Agent id (see apx_agents)."),
        text: z.string().min(1).max(20_000),
        thread: z.string().optional(),
      },
    },
    async ({ agent, text: question, thread }) => {
      try {
        const t = thread ?? (await client.call("threads.create", { kind: "loose", agent_id: agent })).id;
        const sent = await client.call("threads.send", { thread: t, text: question });
        const answer = await answerOf(client, t, sent.run.id, Date.now() + WAIT_MS);
        return text(`${answer}\n\n(thread ${t})`);
      } catch (err) {
        return failed(err);
      }
    },
  );
  server.registerTool(
    "apx_read",
    {
      description: "Read the last messages of a chat you started with apx_ask.",
      inputSchema: { thread: z.string(), last: z.number().int().min(1).max(50).optional() },
    },
    async ({ thread, last }) => {
      try {
        const r = await client.call("threads.get", { thread });
        const lines = r.messages.slice(-(last ?? 10)).map((m) => {
          const who = m.author.kind === "agent" ? m.author.id : m.author.kind === "user" ? "owner" : "you";
          return `${who}: ${m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n")}`;
        });
        return text(lines.join("\n\n") || "(empty)");
      } catch (err) {
        return failed(err);
      }
    },
  );
}
