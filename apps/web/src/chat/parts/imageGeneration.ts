import type { Message, Part, RunState } from "@apx/protocol";
import { type MediaBlock, mediaBlocks } from "./mediaGroups.ts";

export function isGeneratingImage(part: Part, state: RunState | undefined): boolean {
  return (
    (state === "working" || state === "submitted" || state === "queued") &&
    part.type === "tool" &&
    part.tool === "make_image" &&
    part.status === "running"
  );
}

type GenerationBlock = {
  kind: "generation";
  part: Extract<Part, { type: "tool" }>;
  index: number;
  key: string;
  media?: Extract<MediaBlock, { kind: "images" }>;
};

type GenerationScope = Map<string, Extract<Part, { type: "image" }>[]>;

function generationScope(parts: readonly Part[]): GenerationScope {
  const calls = new Set(parts.flatMap((p) => (p.type === "tool" && p.tool === "make_image" ? [p.call_id] : [])));
  const images: GenerationScope = new Map();
  for (const p of parts) {
    if (p.type !== "image" || !p.tool_call_id || !calls.has(p.tool_call_id) || !(p.media_id || p.url)) continue;
    const group = images.get(p.tool_call_id) ?? [];
    group.push(p);
    images.set(p.tool_call_id, group);
  }
  return images;
}

/** A display can split one run across messages when the owner writes while a tool is working. */
export function imageGenerationRuns(messages: readonly Pick<Message, "run_id" | "parts" | "author">[]) {
  const runs = new Map<string, Part[]>();
  for (const message of messages) {
    if (!message.run_id || message.author.kind !== "agent") continue;
    const parts = runs.get(message.run_id) ?? [];
    parts.push(...message.parts);
    runs.set(message.run_id, parts);
  }
  return new Map([...runs].map(([id, parts]) => [id, generationScope(parts)]));
}

/** Generated pictures keep their tool's slot; unrelated and older pictures keep the ordinary media layout. */
export function imageGenerationBlocks(
  parts: readonly Part[],
  state: RunState | undefined,
  skip: (part: Part) => boolean,
  images: GenerationScope = generationScope(parts),
): Array<MediaBlock | GenerationBlock> {
  const blocks = mediaBlocks(parts, (p) => {
    if (p.type === "image" && p.tool_call_id && images.has(p.tool_call_id)) return true;
    if (p.type === "tool") return !(p.tool === "make_image" && (images.has(p.call_id) || isGeneratingImage(p, state)));
    return skip(p);
  });
  return blocks.map((b) => {
    if (b.kind !== "part" || b.part.type !== "tool") return b;
    const key = `generation:${b.part.call_id}`;
    const results = images.get(b.part.call_id);
    return {
      kind: "generation",
      part: b.part,
      index: b.index,
      key,
      ...(results ? { media: { kind: "images", parts: results, key } as const } : {}),
    };
  });
}
