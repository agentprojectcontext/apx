import type { CommandModule, Argv, ArgumentsCamelCase } from "yargs";
import { getHttp, type StreamEvent } from "../http.js";
import { error, println, dim } from "../ui.js";
import { createInterface } from "node:readline";

interface GlobalArgs { project?: string }

async function resolveProjectId(project?: string): Promise<string> {
  const http = await getHttp();
  const projects = (await http.get("/projects")) as Array<{ id: string; name: string; path: string }>;
  if (!projects?.length) throw new Error("No projects registered. Run: apx init");
  if (project) {
    const match = projects.find(
      (p) => p.id === project || p.name === project || p.path === project || p.path?.endsWith("/" + project),
    );
    if (!match) throw new Error(`Project not found: ${project}`);
    return match.id;
  }
  return projects[0]!.id;
}

export const chatCmd: CommandModule = {
  command: "chat [agent]",
  describe: "Start an interactive multi-turn chat with an agent",
  builder: (yargs: Argv) =>
    yargs
      .positional("agent", {
        type: "string",
        default: "default",
        describe: "Agent slug (defaults to super-agent)",
      })
      .option("model", { type: "string", describe: "Override model" })
      .option("conversation", {
        alias: "c",
        type: "string",
        describe: "Continue an existing conversation ID",
      }),
  handler: async (
    args: ArgumentsCamelCase<Record<string, unknown>>,
  ) => {
    try {
      const project = args.project as string | undefined;
      const agent = args.agent as string;
      const model = args.model as string | undefined;
      const http = await getHttp();
      const pid = await resolveProjectId(project);
      let conversationId = args.conversation as string | undefined;

      if (!process.stdin.isTTY) {
        // Non-interactive: read one prompt from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        const prompt = Buffer.concat(chunks).toString().trim();
        if (!prompt) throw new Error("No prompt provided via stdin.");
        const result = (await http.post(`/projects/${pid}/agents/${agent}/chat`, {
          prompt,
          model,
          conversation_id: conversationId,
        })) as { conversation_id: string; text: string };
        process.stdout.write(result.text + "\n");
        return;
      }

      // Interactive REPL
      println(dim(`APX Chat — agent: ${agent}  (type /exit or ctrl+c to quit)`));

      const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
      rl.setPrompt("\x1b[96m> \x1b[0m");
      rl.prompt();

      rl.on("line", async (line) => {
        const text = line.trim();
        if (!text) { rl.prompt(); return; }
        if (text === "/exit" || text === "/quit") { rl.close(); return; }

        rl.pause();
        try {
          // Try streaming first
          let responded = false;
          try {
            const result = await http.streamPost(
              `/projects/${pid}/super-agent/chat/stream`,
              { prompt: text, model, previousMessages: [] },
              (ev: StreamEvent) => {
                if (ev.type === "chunk" && typeof ev.chunk === "string") {
                  process.stdout.write(ev.chunk);
                  responded = true;
                }
              },
            ) as { text?: string };
            if (!responded && result?.text) process.stdout.write(result.text);
            process.stdout.write("\n");
          } catch {
            // Fall back to non-streaming agent chat
            const result = (await http.post(`/projects/${pid}/agents/${agent}/chat`, {
              prompt: text,
              model,
              conversation_id: conversationId,
            })) as { conversation_id: string; text: string };
            conversationId = result.conversation_id;
            process.stdout.write(result.text + "\n");
          }
        } catch (err: unknown) {
          error(err instanceof Error ? err.message : String(err));
        }
        rl.resume();
        rl.prompt();
      });

      rl.on("close", () => {
        println(dim("\nGoodbye."));
        process.exit(0);
      });
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};
