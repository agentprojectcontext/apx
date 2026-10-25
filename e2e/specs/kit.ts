// What every spec shares: the core's protocol, the outside world (e2e/env.ts's control API), and a page that fails
// its test on any console error or uncaught exception.
import { test as base, expect, type Page } from "@playwright/test";
import { startPageCoverage } from "../coverage.ts";

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
      home: string;
      token: string;
      core: string;
      /** The fake model's server, which also embeds (Ollama-style). */
      llm: string;
      discord: string;
      slack: { bot: string; app: string };
    },
  desktopTrash: async () => (await (await fetch(`${control}/desktop/trash`)).json()) as { paths: string[] },
  telegram: async (from: { id: number; name: string }, text: string) => {
    await fetch(`${control}/tg/message`, { method: "POST", body: JSON.stringify({ from, text }) });
  },
  /** Someone writing in a Telegram group the bot is in; `mention` @mentions the bot. */
  telegramGroup: async (
    from: { id: number; name: string; username?: string },
    chat: { id: number; title: string },
    text: string,
    mention?: string,
  ) => {
    const at = mention ? text.indexOf(mention) : -1;
    const extra = at >= 0 ? { entities: [{ type: "mention", offset: at, length: mention?.length ?? 0 }] } : {};
    await post(`${control}/tg/message`, { from, text, chat: { ...chat, type: "supergroup" }, extra });
  },
  /** Someone writing to the Discord or Slack bot in a direct message, and what the bot sent them. */
  dm: async (channel: "dc" | "sl", from: { id: string; name: string }, text: string) => {
    await post(`${control}/${channel}/message`, { from, text });
  },
  /** Someone writing in a room of the Discord server, and what the bot posted there. */
  room: async (from: { id: string; name: string }, room: string, text: string) => {
    await post(`${control}/dc/message`, { from, text, room });
  },
  roomPosts: async (room: string) =>
    (
      (await (await fetch(`${control}/dc/room?room=${room}`)).json()) as {
        sent: Array<{ text?: string; reply: boolean }>;
      }
    ).sent,
  dmSentTo: async (channel: "dc" | "sl", user: string) =>
    ((await (await fetch(`${control}/${channel}/sent?user=${user}`)).json()) as { sent: Array<{ text?: string }> })
      .sent,
  /** Streamed drafts sent to a chat (APX sends none: a draft locks the owner's Telegram chat). */
  draftsTo: async (chat: number) =>
    ((await (await fetch(`${control}/tg/drafts?chat=${chat}`)).json()) as { drafts: Array<{ text?: string }> }).drafts,
  sentTo: async (chat: number) =>
    ((await (await fetch(`${control}/tg/sent?chat=${chat}`)).json()) as { sent: Array<{ text?: string }> }).sent,
  /** The owner's phone on WhatsApp: scan the QR, write in "Message yourself", someone else writing. */
  whatsapp: {
    scan: () => post(`${phone}/scan`),
    fromOwner: (text: string) => post(`${phone}/owner`, { text }),
    /** Someone writes; resolves with WhatsApp's id of the message. */
    message: async (from: { phone: string; name: string }, text: string) =>
      ((await (await post(`${phone}/message`, { from, text })).json()) as { id: string }).id,
    /** The phone holds a message's real content (a video APX kept only as a placeholder), to send when asked again. */
    keep: (id: string, content: object) => post(`${phone}/keep`, { id, content }),
    /** Someone sends a file: `content` as WhatsApp shapes it (videoMessage, documentMessage…), `bytes` base64. */
    media: (from: { phone: string; name: string }, content: object) => post(`${phone}/media`, { from, content }),
    /** The last message sent to `jid` reaches their phone (3) or is read (4). */
    receipt: (jid: string, status: 3 | 4) => post(`${phone}/receipt`, { jid, status }),
    presence: (jid: string, online: boolean) => post(`${phone}/presence`, { jid, online }),
    /** Someone puts an emoji on the last message sent to them ("": takes it off). */
    react: (from: { phone: string; name: string }, emoji: string) => post(`${phone}/react`, { from, emoji }),
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

export const test = base.extend<{
  page: Page;
  cornerCards: boolean;
  welcome: boolean;
  desktopInstallNotice: boolean;
}>({
  // The corner cards and the welcome cover what sits under them, so they start closed unless a spec is about them.
  cornerCards: [false, { option: true }],
  welcome: [false, { option: true }],
  desktopInstallNotice: [false, { option: true }],
  page: async ({ page, cornerCards, welcome, desktopInstallNotice }, use) => {
    if (!desktopInstallNotice) {
      await page.route("**/rpc/desktop.install_status", (route) =>
        route.fulfill({
          json: { ok: true, result: { available: true, installed: true, phase: "idle", received: 0 } },
        }),
      );
    }
    const finishCoverage = await startPageCoverage(page);
    if (!cornerCards || !welcome)
      await page.addInitScript(
        (seed) => {
          // It also runs in sandboxed widget frames, which have no storage.
          try {
            if (!localStorage.getItem("apx.corner")) localStorage.setItem("apx.corner", JSON.stringify(seed));
          } catch {}
        },
        { ...(cornerCards ? {} : { discord: true, star: true }), ...(welcome ? {} : { welcome: true }) },
      );
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !IGNORED.some((r) => r.test(m.text()))) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });
    try {
      await use(page);
    } finally {
      await finishCoverage();
    }
    expect(errors, "console errors").toEqual([]);
  },
});
export { expect };

/** Opens the panel (the setup wizard stays closed unless a test wants it). */
export async function open(page: Page, hash = "") {
  await page.goto(`/${hash}`);
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
}

/** Opens Settings the way the owner does: from the account menu at the bottom of the sidebar. */
export async function openSettings(page: Page) {
  await page.getByRole("button", { name: /^Cuenta/ }).click();
  await page.getByRole("menuitem", { name: /^Configuración(?! inicial)/ }).click();
}
