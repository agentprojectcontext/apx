import type { CdpSend } from "./cdp.ts";
import { ApxError } from "./client.ts";

export const SCRIPT_LIMIT = 64_000;
export const EVALUATION_LIMIT = 16_000;

/** The result is text, not a remote object handle or executable page content. */
export async function evaluatePage(send: CdpSend, script: string): Promise<{ json: string }> {
  if (!script.trim() || script.length > SCRIPT_LIMIT)
    throw new ApxError({ code: "bad_request", message: "script must contain 1–64000 characters" });
  const expression = `(async () => {
    const value = await (0, eval)(${JSON.stringify(script)});
    const json = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
    if (json === undefined) return 'null';
    if (json.length > ${EVALUATION_LIMIT}) throw new Error('evaluation result exceeds ${EVALUATION_LIMIT} characters');
    return json;
  })()`;
  const reply = await send<{
    result: { value?: unknown };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 5000,
  });
  if (reply.exceptionDetails)
    throw new ApxError({
      code: "bad_request",
      message: `JavaScript failed: ${(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text).slice(0, 2000)}`,
    });
  if (typeof reply.result.value !== "string" || reply.result.value.length > EVALUATION_LIMIT)
    throw new ApxError({ code: "bad_request", message: "JavaScript did not return a bounded JSON result" });
  return { json: reply.result.value };
}
