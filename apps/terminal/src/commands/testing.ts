// Test helpers for commands: a client that records calls and answers from a table, and captured output.
import type { ApxClient } from "@apx/protocol/client";

export function recordingClient(answers: Record<string, unknown>) {
  const calls: [string, Record<string, unknown>][] = [];
  const client = {
    async call(method: string, params: Record<string, unknown>) {
      calls.push([method, params]);
      if (!(method in answers)) throw new Error(`unexpected call ${method}`);
      return answers[method];
    },
  } as unknown as ApxClient;
  return { client, calls };
}

/** What `fn` prints with console.log, as one string. */
export async function printed(fn: () => Promise<void>): Promise<string> {
  const out: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.log = log;
  }
  return out.join("\n");
}
