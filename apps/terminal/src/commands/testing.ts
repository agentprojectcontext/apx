// Test helpers for commands: a client that records calls and answers from a table, and captured output.

import { Readable } from "node:stream";
import { isMethodName, methods } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

export function recordingClient(answers: Record<string, unknown>) {
  const calls: [string, Record<string, unknown>][] = [];
  const client = {
    async call(method: string, params: Record<string, unknown>) {
      if (!isMethodName(method)) throw new Error(`unregistered method ${method}`);
      const parsed = methods[method].params.safeParse(params);
      if (!parsed.success) throw new Error(`invalid ${method} params: ${parsed.error.message}`);
      calls.push([method, params]);
      if (!(method in answers)) throw new Error(`unexpected call ${method}`);
      if (answers[method] instanceof Error) throw answers[method];
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

export async function withStdin<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", { configurable: true, value: Readable.from([text]) });
  try {
    return await fn();
  } finally {
    if (descriptor) Object.defineProperty(process, "stdin", descriptor);
    else Reflect.deleteProperty(process, "stdin");
  }
}
