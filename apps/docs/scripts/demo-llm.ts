// An OpenAI-compatible model for the screenshots: it answers like the demo crew would, from a short script picked by
// the owner's last words, so captures show real-looking conversations without calling anyone.
import http from "node:http";
import type { AddressInfo } from "node:net";

type Message = { role: string; content?: unknown };

const SCRIPT: Array<[RegExp, string]> = [
  [
    /plate today|on my plate/i,
    [
      "Here's your day at **Acme Store**:",
      "",
      "1. **Launch plan**: Lucía drafted the Q4 plan and is waiting for your OK.",
      "2. **Checkout fix**: Tomás has the fix in review; it ships tomorrow if you approve.",
      "3. **Newsletter**: Vera scheduled it for Friday at 9:00.",
      "",
      "Nothing is due today. Want me to ping Lucía that you'll look at the plan after lunch?",
    ].join("\n"),
  ],
  [/after lunch|yes,? ping/i, "Done. I told Lucía you'll review the plan at 14:00 and added a reminder for you."],
  [
    /q4 launch|plan the launch/i,
    [
      "Here's a first cut of the **Q4 launch**:",
      "",
      "| Week | What | Who |",
      "|---|---|---|",
      "| 1 | Freeze the catalog and fix the checkout | Tomás |",
      "| 2 | Landing page and emails | Vera |",
      "| 3 | Black Friday campaign goes live | Vera |",
      "| 4 | Review numbers and follow up | Lucía |",
      "",
      "I created four tasks and assigned them. I'll check in every Monday.",
    ].join("\n"),
  ],
  [/checkout/i, "On it. The coupon field breaks when the cart is empty; the fix is on a branch and the tests pass."],
  [
    /newsletter/i,
    'Draft ready: "Friday picks: three bundles under $40". Scheduled for Friday 9:00, sent from Telegram.',
  ],
];

function lastWords(messages: Message[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text =
    typeof last?.content === "string"
      ? last.content
      : Array.isArray(last?.content)
        ? last.content.map((p) => (p as { text?: string }).text ?? "").join("\n")
        : "";
  return text;
}

function answer(messages: Message[]): string {
  const system = String(messages[0]?.content ?? "");
  const said = lastWords(messages);
  if (/title/i.test(system) && system.length < 2000) {
    if (/plate/i.test(said)) return "Today's plan";
    if (/launch/i.test(said)) return "Q4 launch plan";
    if (/checkout/i.test(said)) return "Checkout fix";
    return "Quick question";
  }
  for (const [rx, text] of SCRIPT) if (rx.test(said)) return text;
  return "Sure. I'll take care of it and let you know when it's done.";
}

export async function demoLlm(models: string[]) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ data: models.map((id) => ({ id, object: "model" })) }));
      }
      const body = (raw ? JSON.parse(raw) : {}) as { messages?: Message[]; stream?: boolean };
      const text = answer(body.messages ?? []);
      const usage = { prompt_tokens: 8120, completion_tokens: 96, total_tokens: 8216 };
      if (!body.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            id: "demo",
            choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
            usage,
          }),
        );
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      for (const part of text.match(/[\s\S]{1,24}/g) ?? [text])
        send({ id: "demo", choices: [{ index: 0, delta: { content: part }, finish_reason: null }] });
      send({ id: "demo", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      send({ id: "demo", choices: [], usage });
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
