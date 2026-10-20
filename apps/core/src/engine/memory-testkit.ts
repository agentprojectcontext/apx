import type { LlmRequest } from "../providers/llm.ts";
import { say } from "./testkit.ts";

/** A scripted positive reviewer for tests of plumbing; semantic rejection tests supply their own verdicts. */
export function supportMemoryClaims(req: LlmRequest) {
  const input = JSON.parse(String(req.messages.at(-1)?.content)) as { claims: unknown[] };
  return say(JSON.stringify({ verdicts: input.claims.map((_, index) => ({ index, verdict: "supported" })) }));
}
