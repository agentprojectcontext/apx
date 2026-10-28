// The desktop's tabs over webContents.debugger: no remote-debugging port, so nothing else on the machine can drive
// the app. What a page can be asked (snapshot, click, type…) is shared with the core's headless Chrome (@apx/protocol/cdp).

import { CdpPage, withTimeout } from "@apx/protocol/cdp";
import { ApxError } from "@apx/protocol/client";
import type { WebContents } from "electron";

export class CdpTab {
  readonly #wc: WebContents;
  readonly #page: CdpPage;
  #attached = false;

  constructor(wc: WebContents) {
    this.#wc = wc;
    this.#page = new CdpPage((method, params) => this.send(method, params), {
      selectAllModifiers: process.platform === "darwin" ? 4 : 2,
    });
  }

  async attach(): Promise<void> {
    if (this.#attached) return;
    const dbg = this.#wc.debugger;
    dbg.attach("1.3");
    dbg.on("detach", () => {
      this.#attached = false;
    });
    this.#attached = true;
    // Runtime.enable is deliberately not called: it is a classic bot-detection signal.
    await this.send("Page.enable");
    await this.send("DOM.enable");
    await this.send("Accessibility.enable");
    this.#wc.on("did-navigate", () => this.#page.forget());
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

  evaluate(script: string, origin: string) {
    return this.#page.evaluate(script, origin);
  }

  click(ref: string) {
    return this.#page.click(ref);
  }

  type(ref: string, text: string, submit: boolean) {
    return this.#page.type(ref, text, submit);
  }

  /** CDP capture, then compositor capture; both bounded. See HISTORY.md#cdp-attach-after-load */
  async screenshot(): Promise<Buffer> {
    try {
      return Buffer.from(await this.#page.screenshot(), "base64");
    } catch {
      const image = await withTimeout(this.#wc.capturePage(), 4_000);
      if (image.isEmpty()) throw new ApxError({ code: "unavailable", message: "tab is not painting (window hidden?)" });
      return (image.getSize().width > 1280 ? image.resize({ width: 1280 }) : image).toJPEG(70);
    }
  }
}
