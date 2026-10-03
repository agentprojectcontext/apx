// What every spec shares: the core's protocol, the outside world (e2e/env.ts's control API), and a page that fails
// its test on any console error or uncaught exception.
import { test as base, expect, type Page } from "@playwright/test";

const core = `http://127.0.0.1:${process.env.E2E_PORT ?? 7460}`;
const control = `http://127.0.0.1:${process.env.E2E_CONTROL_PORT ?? 7461}`;
const phone = `http://127.0.0.1:${process.env.E2E_WA_PORT ?? 7462}`;
const post = (url: string, body: unknown = {}) => fetch(url, { method: "POST", body: JSON.stringify(body) });
let seq = 0;

/** A protocol call, as the owner. */
export async function rpc<T = Record<string, unknown>>(method: string, params: unknown = {}): Promise<T> {
  const res = await fetch(`${core}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `e2e-${Date.now()}-${seq++}` },
    body: JSON.stringify(params),
  });
  const body = (await res.json()) as { ok: boolean; result?: T; error?: { message: string } };
  if (!body.ok) throw new Error(`${method}: ${body.error?.message}`);
  return body.result as T;
}

/** The emulated outside: where things are, a Telegram user writing, what the bot sent. */
export const world = {
  info: async () =>
    (await (await fetch(`${control}/info`)).json()) as {
      dir: string;
      repo: string;
      token: string;
      core: string;
      /** The fake model's server, which also embeds (Ollama-style). */
      llm: string;
    },
  telegram: async (from: { id: number; name: string }, text: string) => {
    await fetch(`${control}/tg/message`, { method: "POST", body: JSON.stringify({ from, text }) });
  },
  sentTo: async (chat: number) =>
    ((await (await fetch(`${control}/tg/sent?chat=${chat}`)).json()) as { sent: Array<{ text?: string }> }).sent,
  /** The owner's phone on WhatsApp: scan the QR, write in "Message yourself", someone else writing. */
  whatsapp: {
    scan: () => post(`${phone}/scan`),
    fromOwner: (text: string) => post(`${phone}/owner`, { text }),
    message: (from: { phone: string; name: string }, text: string) => post(`${phone}/message`, { from, text }),
    sentTo: async (jid: string) =>
      (
        (await (await fetch(`${phone}/sent?jid=${encodeURIComponent(jid)}`)).json()) as {
          owner: string;
          sent: string[];
        }
      ).sent,
  },
  llmCalls: async () => ((await (await fetch(`${control}/llm/calls`)).json()) as { calls: number }).calls,
};

/** Polls until `fn` returns something truthy. */
export async function until<T>(fn: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 150));
  }
}

// Noise that is not the app's: the favicon, and a fetch the browser aborts when a test navigates away.
const IGNORED = [/favicon/i, /net::ERR_ABORTED/];

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !IGNORED.some((r) => r.test(m.text()))) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });
    await use(page);
    expect(errors, "console errors").toEqual([]);
  },
});
export { expect };

/** Opens the panel (the setup wizard stays closed unless a test wants it). */
export async function open(page: Page, hash = "") {
  await page.goto(`/${hash}`);
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
}
