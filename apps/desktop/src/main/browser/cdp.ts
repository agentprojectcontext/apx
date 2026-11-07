// The desktop's tabs over webContents.debugger: no remote-debugging port, so nothing else on the machine can drive
// the app. What a page can be asked (snapshot, click, type…) is shared with the core's headless Chrome (@apx/protocol/cdp).

import type { BrowserFillSecret, ElementEdit } from "@apx/protocol";
import { CdpPage, withTimeout } from "@apx/protocol/cdp";
import { ApxError } from "@apx/protocol/client";
import type { WebContents } from "electron";

export class CdpTab {
  readonly #wc: WebContents;
  readonly #page: CdpPage;
  #attached = false;
  onInvalidate: () => void = () => {};

  constructor(wc: WebContents) {
    this.#wc = wc;
    this.#page = new CdpPage((method, params) => this.send(method, params), {
      selectAllModifiers: process.platform === "darwin" ? 4 : 2,
    });
    wc.debugger.on("detach", () => {
      this.#attached = false;
      // The document stays: a field filled from a secret stays protected.
      this.#invalidate(true);
    });
    wc.on("did-navigate", () => this.#invalidate());
    wc.on("did-navigate-in-page", () => this.#invalidate(true));
  }

  async attach(): Promise<void> {
    if (this.#attached) return;
    const dbg = this.#wc.debugger;
    dbg.attach("1.3");
    this.#attached = true;
    // Runtime.enable is deliberately not called: it is a classic bot-detection signal.
    await this.send("Page.enable");
    await this.send("DOM.enable");
    await this.send("Accessibility.enable");
  }

  #invalidate(sameDocument = false): void {
    this.#page.forget(sameDocument);
    this.onInvalidate();
  }

  send<T = unknown>(method: string, params?: object): Promise<T> {
    if (!this.#attached) {
      // DevTools opened by the user detaches the agent; reattach on next use.
      return this.attach().then(() => this.#wc.debugger.sendCommand(method, params) as Promise<T>);
    }
    return this.#wc.debugger.sendCommand(method, params) as Promise<T>;
  }

  snapshot(maxChars: number) {
    return this.#page.snapshot(maxChars);
  }

  get consentEpoch(): string {
    return this.#page.consentEpoch;
  }

  approvalContext(origin: string, document: string) {
    return this.#page.approvalContext(origin, document);
  }

  evaluate(script: string, origin: string, document: string, epoch?: string) {
    return this.#page.evaluate(script, origin, document, epoch);
  }

  inspect(x: number, y: number) {
    return this.#page.inspect(x, y);
  }

  previewEdits(edits: readonly ElementEdit[]) {
    return this.#page.previewEdits(edits);
  }

  click(ref: string) {
    return this.#page.click(ref);
  }

  type(ref: string, text: string, submit: boolean) {
    return this.#page.type(ref, text, submit);
  }

  fillSecret(ref: string, req: Pick<BrowserFillSecret, "kind" | "origins" | "value">) {
    return this.#page.fillSecret(ref, req);
  }

  /** Text with any value filled in this tab taken out. */
  scrub(text: string): string {
    return this.#page.scrub(text);
  }

  /** Refuses reading a page that copied a secret's value; takes out any value filled into it. */
  readable(text: string): string {
    this.#page.assertReadable();
    return this.#page.scrub(text);
  }

  /** CDP capture, then compositor capture; both bounded. See HISTORY.md#cdp-attach-after-load */
  async screenshot(): Promise<Buffer> {
    try {
      return Buffer.from(await this.#page.screenshot(), "base64");
    } catch (err) {
      // The compositor's picture cannot cover a field filled from a secret.
      if (this.#page.holdsSecret) throw err;
      const image = await withTimeout(this.#wc.capturePage(), 4_000);
      if (image.isEmpty()) throw new ApxError({ code: "unavailable", message: "tab is not painting (window hidden?)" });
      return (image.getSize().width > 1280 ? image.resize({ width: 1280 }) : image).toJPEG(70);
    }
  }
}
