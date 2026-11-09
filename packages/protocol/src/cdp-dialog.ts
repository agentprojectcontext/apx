// A page's JavaScript dialog (alert, confirm, prompt, leave-page warning). While one is open the page runs nothing:
// a read or a click through it would wait forever, so the dialog is learnt from CDP's events and answered over CDP.
import type { BrowserDialog } from "./browser.ts";
import { ApxError } from "./client.ts";

type CdpSend = <T = unknown>(method: string, params?: object) => Promise<T>;

const OK = "dialog-ok";
const CANCEL = "dialog-cancel";
const TEXT = "dialog-text";
const MESSAGE_CHARS = 500;

export const isDialogRef = (ref: string): boolean => ref === OK || ref === CANCEL || ref === TEXT;

export class PageDialog {
  readonly #send: CdpSend;
  readonly #answered: () => void;
  #open: { type: BrowserDialog; message: string; defaultPrompt: string; url: string } | undefined;
  #text: string | undefined;
  #waiters = new Set<() => void>();

  /** `answered`: after the agent answered one (Electron keeps its own box for it on screen until told). */
  constructor(send: CdpSend, answered: () => void = () => {}) {
    this.#send = send;
    this.#answered = answered;
  }

  get kind(): BrowserDialog | undefined {
    return this.#open?.type;
  }

  /** The address of the frame that opened the dialog open now, as the browser reported it. */
  get url(): string {
    return this.#open?.url ?? "";
  }

  /** The page's CDP events; only the dialog ones matter here. */
  onEvent(method: string, params: unknown): void {
    if (method === "Page.javascriptDialogOpening") {
      const p = (params ?? {}) as { type?: string; message?: unknown; defaultPrompt?: unknown; url?: unknown };
      const type = (["alert", "confirm", "prompt", "beforeunload"] as const).find((t) => t === p.type) ?? "alert";
      const url = String(p.url ?? "");
      this.#open = { type, message: String(p.message ?? ""), defaultPrompt: String(p.defaultPrompt ?? ""), url };
      this.#text = undefined;
      for (const wake of this.#waiters) wake();
      this.#waiters.clear();
    } else if (method === "Page.javascriptDialogClosed") {
      this.#open = undefined;
      this.#text = undefined;
    }
  }

  assertClosed(): void {
    if (this.#open)
      throw new ApxError({
        code: "conflict",
        message: `the page shows ${this.#open.type === "alert" ? "an" : "a"} ${this.#open.type} dialog and waits for it: take a snapshot and answer it first`,
      });
  }

  /**
   * Waits for an input command, or only until it opens a dialog: the command itself then answers once the dialog
   * closes. Returns the dialog it opened.
   */
  async input(command: Promise<unknown>): Promise<BrowserDialog | undefined> {
    command.catch(() => {});
    if (this.#open) return this.#open.type;
    let wake = () => {};
    const opened = new Promise<void>((resolve) => {
      wake = resolve;
    });
    this.#waiters.add(wake);
    try {
      await Promise.race([command, opened]);
    } finally {
      this.#waiters.delete(wake);
    }
    return this.kind;
  }

  /** What a snapshot shows while the dialog is open: the page behind it cannot be read. */
  tree(clip: (s: string, max: number) => string, scrub: (s: string) => string): { tree: string; refs: number } {
    const d = this.#open;
    if (!d) return { tree: "", refs: 0 };
    const message = clip(d.message.replace(/\s+/g, " ").trim(), MESSAGE_CHARS);
    const leave = d.type === "beforeunload";
    const lines = [`- dialog ${d.type}${message ? ` "${message}"` : ""} (the page waits for an answer)`];
    if (d.type === "prompt") lines.push(`  - textbox = "${clip(this.#text ?? d.defaultPrompt, 60)}" [${TEXT}]`);
    lines.push(`  - button "${leave ? "Leave" : "OK"}" [${OK}]`);
    if (d.type !== "alert") lines.push(`  - button "${leave ? "Stay" : "Cancel"}" [${CANCEL}]`);
    return { tree: scrub(lines.join("\n")), refs: lines.length - 1 };
  }

  click(ref: string): Promise<void> {
    if (ref === TEXT) return this.#need("prompt").then(() => {});
    return this.#answer(ref === OK);
  }

  /** The prompt's answer; sent with OK, or right away with `submit`. */
  async type(ref: string, text: string, submit: boolean): Promise<void> {
    if (ref !== TEXT) throw new ApxError({ code: "bad_request", message: `${ref} is a button: click it` });
    await this.#need("prompt");
    this.#text = text;
    if (submit) await this.#answer(true);
  }

  async #need(type: BrowserDialog): Promise<void> {
    if (!this.#open) throw new ApxError({ code: "conflict", message: "no dialog is open now: take a new snapshot" });
    if (this.#open.type !== type)
      throw new ApxError({ code: "bad_request", message: `this ${this.#open.type} dialog has no text field` });
  }

  async #answer(accept: boolean): Promise<void> {
    const d = this.#open;
    if (!d) throw new ApxError({ code: "conflict", message: "no dialog is open now: take a new snapshot" });
    const text = d.type === "prompt" && accept ? (this.#text ?? d.defaultPrompt) : undefined;
    try {
      await this.#send("Page.handleJavaScriptDialog", { accept, ...(text !== undefined ? { promptText: text } : {}) });
    } catch (error) {
      // Someone else answered it first (the owner, on screen).
      if (!/no dialog/i.test(error instanceof Error ? error.message : String(error))) throw error;
      this.onEvent("Page.javascriptDialogClosed", {});
      throw new ApxError({ code: "conflict", message: "the dialog was already closed: take a new snapshot" });
    }
    this.onEvent("Page.javascriptDialogClosed", {});
    this.#answered();
  }
}
