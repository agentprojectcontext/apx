import type { ServerResponse } from "node:http";

type Held = { phases: Array<() => void>; response?: ServerResponse; timer: ReturnType<typeof setTimeout> };

/** A test advances observable model phases only after asserting the previous phase on screen. */
export function streamControls() {
  const held = new Map<string, Held>();
  const remove = (prefix: string) => {
    const entry = held.get(prefix);
    if (entry) clearTimeout(entry.timer);
    held.delete(prefix);
  };
  return {
    handle(url: string | undefined, raw: string, res: ServerResponse): boolean {
      if (url !== "/v1/stream-control") return false;
      const { prefix, action } = JSON.parse(raw) as { prefix?: string; action?: string };
      if (!prefix || !["hold", "next", "release"].includes(action ?? "")) {
        res.writeHead(400);
        res.end("invalid stream control");
        return true;
      }
      const key = prefix.toLowerCase();
      if (action === "hold") {
        if (held.has(key)) {
          res.writeHead(409);
          res.end("stream already held");
          return true;
        }
        const timer = setTimeout(() => {
          held.get(key)?.response?.destroy();
          remove(key);
        }, 30_000);
        timer.unref();
        held.set(key, { phases: [], timer });
      } else {
        const entry = held.get(key);
        if (action === "next" && !entry?.phases.length) {
          res.writeHead(409);
          res.end("no pending stream phase");
          return true;
        }
        if (action === "next") entry?.phases.shift()?.();
        else {
          while (entry?.phases.length) entry.phases.shift()?.();
          remove(key);
        }
      }
      res.writeHead(200);
      res.end("ok");
      return true;
    },
    start(said: string, response: ServerResponse, phases: Array<() => void>): boolean {
      const match = [...held].find(([prefix]) => said.toLowerCase().startsWith(prefix));
      if (!match) return false;
      const [prefix, entry] = match;
      entry.response = response;
      entry.phases = phases.slice(1);
      response.once("close", () => remove(prefix));
      phases[0]?.();
      return true;
    },
    close() {
      for (const [prefix, entry] of held) {
        entry.response?.destroy();
        remove(prefix);
      }
    },
  };
}

export function streamAnswer(
  res: ServerResponse,
  said: string,
  text: string,
  usage: unknown,
  controls: ReturnType<typeof streamControls>,
) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const content = (part: string) =>
    send({ id: "fake", choices: [{ index: 0, delta: { content: part }, finish_reason: null }] });
  const thought = (part: string) =>
    send({ id: "fake", choices: [{ index: 0, delta: { reasoning_content: part }, finish_reason: null }] });
  const end = () => {
    send({ id: "fake", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    send({ id: "fake", choices: [], usage });
    res.end("data: [DONE]\n\n");
  };
  const chunks = text.match(/[\s\S]{1,12}/g) ?? [text];
  const answer = () => {
    for (const part of chunks) content(part);
    end();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  res.once("close", () => {
    if (timer) clearTimeout(timer);
  });
  if (/^think first/i.test(said)) {
    const thoughts = ["**Reading the ask**\n\nThe owner wants a plan. ", "**Checking the dates**\n\nLaunch is close."];
    if (controls.start(said, res, [...thoughts.map((part) => () => thought(part)), answer])) return;
    const next = (i: number) => {
      if (res.writableEnded) return;
      if (i >= thoughts.length) return answer();
      thought(thoughts[i] ?? "");
      timer = setTimeout(() => next(i + 1), 1200);
    };
    return next(0);
  }
  if (/^write slowly/i.test(said)) {
    const cut = text.lastIndexOf("Done.");
    if (
      cut >= 0 &&
      controls.start(said, res, [
        () => content(text.slice(0, cut)),
        () => {
          content(text.slice(cut));
          end();
        },
      ])
    )
      return;
    const next = (i: number) => {
      if (res.writableEnded) return;
      if (i >= chunks.length) return end();
      content(chunks[i] ?? "");
      timer = setTimeout(() => next(i + 1), 150);
    };
    return next(0);
  }
  answer();
}
