// In-process CDP over webContents.debugger: no remote-debugging port, so nothing else on the machine can drive
// the app. Refs are backendNodeIds from the accessibility tree (stable while the document lives, DOM untouched).
import { ApxError } from "@apx/protocol/client";
import type { WebContents } from "electron";

type AXNode = {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string | number };
  backendDOMNodeId?: number;
  childIds?: string[];
  parentId?: string;
};

const SKIP_ROLES =
  /^(generic|none|presentation|StaticText|InlineTextBox|LineBreak|RootWebArea|paragraph|group|Section)$/;
const INTERACTIVE =
  /^(link|button|textbox|searchbox|combobox|checkbox|radio|switch|tab|menuitem|option|slider|spinbutton|listbox)$/;
// Fields the agent must never fill: the human does it through "take control" / handoff.
const CREDENTIAL_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/;

export class CdpTab {
  readonly #wc: WebContents;
  #refs = new Map<string, number>();
  #attached = false;

  constructor(wc: WebContents) {
    this.#wc = wc;
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
    this.#wc.on("did-navigate", () => this.#refs.clear());
  }

  send<T = unknown>(method: string, params?: object): Promise<T> {
    if (!this.#attached) {
      // DevTools opened by the user detaches the agent; reattach on next use.
      return this.attach().then(() => this.#wc.debugger.sendCommand(method, params) as Promise<T>);
    }
    return this.#wc.debugger.sendCommand(method, params) as Promise<T>;
  }

  async snapshot(maxChars: number): Promise<{ tree: string; refs: number; truncated: boolean }> {
    await this.send("DOM.getDocument", { depth: 0 });
    const { nodes } = await this.send<{ nodes: AXNode[] }>("Accessibility.getFullAXTree");
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const root = nodes.find((n) => !n.parentId) ?? nodes[0];
    this.#refs.clear();
    const lines: string[] = [];
    let i = 0;
    let size = 0;
    let truncated = false;

    const visit = (node: AXNode, depth: number) => {
      if (truncated) return;
      const role = node.role?.value ?? "";
      const name = String(node.name?.value ?? "").trim();
      const shown = !node.ignored && !SKIP_ROLES.test(role) && (name !== "" || INTERACTIVE.test(role));
      if (shown) {
        let line = `${"  ".repeat(depth)}- ${role}${name ? ` "${name.slice(0, 100)}"` : ""}`;
        if (node.backendDOMNodeId && (INTERACTIVE.test(role) || role === "heading" || role === "img")) {
          const ref = `e${++i}`;
          this.#refs.set(ref, node.backendDOMNodeId);
          line += ` [${ref}]`;
        }
        const value = node.value?.value;
        if (value !== undefined && value !== "") line += ` = "${String(value).slice(0, 60)}"`;
        size += line.length + 1;
        if (size > maxChars) {
          truncated = true;
          return;
        }
        lines.push(line);
      }
      for (const id of node.childIds ?? []) {
        const child = byId.get(id);
        if (child) visit(child, shown ? depth + 1 : depth);
      }
    };
    if (root) visit(root, 0);
    return { tree: lines.join("\n"), refs: i, truncated };
  }

  async click(ref: string): Promise<void> {
    const { x, y } = await this.#center(ref);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async type(ref: string, text: string, submit: boolean): Promise<void> {
    const backendNodeId = this.#backend(ref);
    await this.#assertNotCredentialField(backendNodeId);
    await this.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    await this.send("DOM.focus", { backendNodeId });
    // Select existing content so the new text replaces it, like a user would.
    await this.#key("a", "KeyA", 65, process.platform === "darwin" ? 4 : 2, undefined, ["selectAll"]);
    await this.send("Input.insertText", { text });
    if (submit) await this.#key("Enter", "Enter", 13, 0, "\r");
  }

  /** CDP capture, then compositor capture; both bounded. See HISTORY.md#cdp-attach-after-load */
  async screenshot(): Promise<Buffer> {
    try {
      const { data } = await withTimeout(
        this.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 70, optimizeForSpeed: true }),
        4_000,
      );
      return Buffer.from(data, "base64");
    } catch {
      const image = await withTimeout(this.#wc.capturePage(), 4_000);
      if (image.isEmpty()) throw new ApxError({ code: "unavailable", message: "tab is not painting (window hidden?)" });
      return (image.getSize().width > 1280 ? image.resize({ width: 1280 }) : image).toJPEG(70);
    }
  }

  #backend(ref: string): number {
    const id = this.#refs.get(ref);
    if (!id)
      throw new ApxError({ code: "bad_request", message: `ref ${ref} is stale or unknown: take a new snapshot` });
    return id;
  }

  async #center(ref: string): Promise<{ x: number; y: number }> {
    const backendNodeId = this.#backend(ref);
    await this.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const { quads } = await this.send<{ quads: number[][] }>("DOM.getContentQuads", { backendNodeId });
    const q = quads[0];
    if (!q || q.length < 8) throw new ApxError({ code: "bad_request", message: `ref ${ref} is not visible` });
    const xs = [q[0], q[2], q[4], q[6]] as number[];
    const ys = [q[1], q[3], q[5], q[7]] as number[];
    return { x: xs.reduce((a, b) => a + b) / 4, y: ys.reduce((a, b) => a + b) / 4 };
  }

  async #assertNotCredentialField(backendNodeId: number): Promise<void> {
    const { node } = await this.send<{ node: { nodeName: string; attributes?: string[] } }>("DOM.describeNode", {
      backendNodeId,
    });
    const attrs = new Map<string, string>();
    const raw = node.attributes ?? [];
    for (let k = 0; k + 1 < raw.length; k += 2)
      attrs.set(String(raw[k]).toLowerCase(), String(raw[k + 1]).toLowerCase());
    const type = attrs.get("type") ?? "";
    const autocomplete = attrs.get("autocomplete") ?? "";
    if (type === "password" || CREDENTIAL_AUTOCOMPLETE.test(autocomplete)) {
      throw new ApxError({
        code: "credential_field",
        message: "this field takes a password, one-time code or card data: ask the human to take control",
      });
    }
  }

  async #key(key: string, code: string, keyCode: number, modifiers: number, text?: string, commands?: string[]) {
    const base = { key, code, windowsVirtualKeyCode: keyCode, modifiers };
    // Editing shortcuts (select all…) only run through `commands`; a bare Cmd+A key event does nothing via CDP.
    await this.send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      ...base,
      ...(text ? { text } : {}),
      ...(commands ? { commands } : {}),
    });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ApxError({ code: "timeout", message: `timed out after ${ms}ms` })), ms),
    ),
  ]);
}
