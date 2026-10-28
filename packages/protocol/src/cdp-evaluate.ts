import type { CdpSend } from "./cdp.ts";
import { ApxError } from "./client.ts";

export const SCRIPT_LIMIT = 64_000;
export const EVALUATION_LIMIT = 16_000;

/** One retained document per tab; another snapshot invalidates an older review rather than leaking handles. */
export async function captureDocument(send: CdpSend): Promise<string> {
  await send("Runtime.releaseObjectGroup", { objectGroup: "apx-browser-review" });
  const reply = await send<{ result: { objectId?: string } }>("Runtime.evaluate", {
    expression:
      "(() => { const doc = document, href = location.href; return () => document === doc && location.href === href; })()",
    objectGroup: "apx-browser-review",
    returnByValue: false,
  });
  if (!reply.result.objectId) throw new ApxError({ code: "bad_request", message: "cannot capture the page document" });
  return reply.result.objectId;
}

/** The result is bounded JSON; the retained Document keeps execution in the context that was reviewed. */
export async function evaluatePage(
  send: CdpSend,
  script: string,
  origin: string,
  document: string,
): Promise<{ json: string }> {
  if (!script.trim() || script.length > SCRIPT_LIMIT)
    throw new ApxError({ code: "bad_request", message: "script must contain 1–64000 characters" });
  const expected = new URL(origin);
  if (!/^https?:$/.test(expected.protocol) || expected.origin !== origin)
    throw new ApxError({ code: "bad_request", message: "expected an exact http(s) origin" });
  const source = script.trimEnd().replace(/;$/, "");
  let body = `return (\n${source}\n);`;
  try {
    // Parse only, never execute on the host; statement files have no implicit completion value.
    new Function(`return async () => { ${body} };`);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    body = script;
  }
  const functionDeclaration = `async function() {
    if (!this()) throw new Error('document or URL changed; take a new snapshot and approve again');
    if (location.origin !== ${JSON.stringify(origin)}) throw new Error('tab origin changed; approve again');
    const value = await (async function() {\n${body}\n}).call(globalThis);
    const json = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
    if (json === undefined) return 'null';
    if (json.length > ${EVALUATION_LIMIT}) throw new Error('evaluation result exceeds ${EVALUATION_LIMIT} characters');
    return json;
  }`;
  const reply = await send<{
    result: { value?: unknown };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>("Runtime.callFunctionOn", {
    objectId: document,
    functionDeclaration,
    awaitPromise: true,
    returnByValue: true,
  }).catch((error: unknown) => {
    const message = String(error).slice(0, 2000);
    throw new ApxError({
      code: "bad_request",
      message: /cannot find.*(context|object)|context.*destroyed/i.test(message)
        ? "Page document changed; take a new snapshot and approve again"
        : `JavaScript result unavailable; inspect the tab before retrying: ${message}`,
    });
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
