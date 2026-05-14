import type { CommandModule, Argv, ArgumentsCamelCase } from "yargs";
import { getHttp, type StreamEvent } from "../http.js";
import { error } from "../ui.js";

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

export const execCmd: CommandModule = {
  command: "exec <agent> [prompt..]",
  aliases: ["run"],
  describe: "Run a one-shot prompt through an agent (non-interactive)",
  builder: (yargs: Argv) =>
    yargs
      .positional("agent", { type: "string", demandOption: true, describe: "Agent slug" })
      .positional("prompt", { type: "string", array: true, describe: "Prompt text" })
      .option("model", { type: "string", describe: "Override model" })
      .option("max-tokens", { type: "number", describe: "Max output tokens" })
      .option("temperature", { type: "number", describe: "Sampling temperature (0–1)" })
      .option("format", {
        choices: ["text", "json"] as const,
        default: "text" as const,
        describe: "Output format",
      })
      .option("stream", {
        type: "boolean",
        default: true,
        describe: "Stream output as it arrives",
      }),
  handler: async (
    args: ArgumentsCamelCase<Record<string, unknown>>,
  ) => {
    try {
      const project = args.project as string | undefined;
      const agent = args.agent as string;
      const promptArgs = args.prompt as string[] | undefined;
      const model = args.model as string | undefined;
      const maxTokens = args.maxTokens as number | undefined;
      const temperature = args.temperature as number | undefined;
      const format = args.format as "text" | "json";
      const stream = args.stream as boolean;

      // Build prompt from args + stdin
      let prompt = (promptArgs ?? []).join(" ");
      if (!process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        const piped = Buffer.concat(chunks).toString().trim();
        if (piped) prompt = prompt ? prompt + "\n\n" + piped : piped;
      }
      if (!prompt) throw new Error("No prompt provided. Pass text as argument or via stdin.");

      const http = await getHttp();
      const pid = await resolveProjectId(project);
      const body = {
        prompt,
        model,
        maxTokens,
        temperature,
      };

      if (stream) {
        // Try streaming endpoint first
        try {
          const result = await http.streamPost(
            `/projects/${pid}/super-agent/chat/stream`,
            { ...body, contextNote: `Agent: ${agent}` },
            (ev: StreamEvent) => {
              if (ev.type === "chunk" && typeof ev.chunk === "string") {
                process.stdout.write(ev.chunk);
              }
              if (ev.type === "event" && ev.event === "assistant_text" && typeof (ev as Record<string, unknown>).text === "string") {
                process.stdout.write((ev as Record<string, unknown>).text as string);
              }
            },
          ) as { text?: string };
          if (!result?.text) process.stdout.write("\n");
          return;
        } catch {
          // Fall through to non-streaming
        }
      }

      const result = (await http.post(`/projects/${pid}/agents/${agent}/exec`, body)) as {
        text: string; usage?: { input_tokens: number; output_tokens: number };
      };
      if (format === "json") {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        process.stdout.write(result.text + "\n");
      }
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};
