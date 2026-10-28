// Driving one page over the Chrome DevTools Protocol, the same way wherever the page lives: the desktop app's tabs
// (Electron's debugger) or the core's own headless Chrome. Refs are backendNodeIds from the accessibility tree
// (stable while the document lives, DOM untouched).
import { evaluatePage } from "./cdp-evaluate.ts";
import { ApxError } from "./client.ts";

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

/** Sends one CDP command to the page and returns its result. */
export type CdpSend = <T = unknown>(method: string, params?: object) => Promise<T>;

const SKIP_ROLES =
  /^(generic|none|presentation|StaticText|InlineTextBox|LineBreak|RootWebArea|paragraph|group|Section)$/;
const INTERACTIVE =
  /^(link|button|textbox|searchbox|combobox|checkbox|radio|switch|tab|menuitem|option|slider|spinbutton|listbox)$/;
// Fields the agent must never fill: the human does it through "take control" / handoff.
const CREDENTIAL_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/;

/** Widest tab picture taken, in pixels: what a model reads well, a retina tab would be twice its viewport. */
const SHOT_WIDTH = 1280;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]);

/**
 * Where a tab may go: http(s) only, no credentials in the address, never APX itself (a driven tab would hold the
 * owner's controls) nor link-local or cloud-metadata addresses.
 */
export function assertNavigable(url: string, blockedPorts: ReadonlySet<string>): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ApxError({ code: "bad_request", message: `not a URL: ${url}` });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new ApxError({ code: "bad_request", message: `navigation blocked: only http(s), got ${u.protocol}` });
  if (u.username || u.password)
    throw new ApxError({ code: "bad_request", message: "navigation blocked: credentials in URL" });
  if (LOOPBACK.has(u.hostname) && blockedPorts.has(u.port || "80"))
    throw new ApxError({ code: "bad_request", message: "navigation blocked: that is APX itself" });
  if (/^169\.254\./.test(u.hostname) || u.hostname === "metadata.google.internal")
    throw new ApxError({ code: "bad_request", message: "navigation blocked: link-local/metadata address" });
}

export class CdpPage {
  readonly #send: CdpSend;
  readonly #selectAll: number;
  #refs = new Map<string, number>();

  /** `selectAllModifiers`: the modifier bits for "select all" on the machine the page runs on (Meta=4 on a Mac). */
  constructor(send: CdpSend, opts: { selectAllModifiers: number }) {
    this.#send = send;
    this.#selectAll = opts.selectAllModifiers;
  }

  /** A new document: the refs of the last snapshot point at nothing now. */
  forget(): void {
    this.#refs.clear();
  }

  async snapshot(maxChars: number): Promise<{ tree: string; refs: number; truncated: boolean }> {
    await this.#send("DOM.getDocument", { depth: 0 });
    const { nodes } = await this.#send<{ nodes: AXNode[] }>("Accessibility.getFullAXTree");
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

  evaluate(script: string) {
    return withTimeout(evaluatePage(this.#send, script), 7_000);
  }

  async click(ref: string): Promise<void> {
    const { x, y } = await this.#center(ref);
    await this.#send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.#send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.#send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async type(ref: string, text: string, submit: boolean): Promise<void> {
    const backendNodeId = this.#backend(ref);
    await this.#assertNotCredentialField(backendNodeId);
    await this.#send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    await this.#send("DOM.focus", { backendNodeId });
    // Select existing content so the new text replaces it, like a user would.
    await this.#key("a", "KeyA", 65, this.#selectAll, undefined, ["selectAll"]);
    await this.#send("Input.insertText", { text });
    if (submit) await this.#key("Enter", "Enter", 13, 0, "\r");
  }

  /** A JPEG of what the page shows (base64), at most SHOT_WIDTH pixels wide, bounded in time. */
  async screenshot(timeoutMs = 4_000): Promise<string> {
    const shoot = async () => {
      const clip = await this.#viewportClip().catch(() => undefined);
      return this.#send<{ data: string }>("Page.captureScreenshot", {
        format: "jpeg",
        quality: 70,
        optimizeForSpeed: true,
        ...(clip ? { clip, captureBeyondViewport: false } : {}),
      });
    };
    const { data } = await withTimeout(shoot(), timeoutMs);
    return data;
  }

  /** The visible part of the page, scaled so the picture (in device pixels) fits SHOT_WIDTH. */
  async #viewportClip() {
    type Viewport = { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
    const m = await this.#send<{ cssVisualViewport?: Viewport; visualViewport?: Viewport }>("Page.getLayoutMetrics");
    const css = m.cssVisualViewport;
    if (!css?.clientWidth || !css.clientHeight) return undefined;
    // The device-pixel viewport over the CSS one: 2 on a retina screen, where the picture would be twice as wide.
    const ratio = m.visualViewport?.clientWidth ? m.visualViewport.clientWidth / css.clientWidth : 1;
    const scale = Math.min(1, SHOT_WIDTH / (css.clientWidth * ratio));
    return { x: css.pageX, y: css.pageY, width: css.clientWidth, height: css.clientHeight, scale };
  }

  #backend(ref: string): number {
    const id = this.#refs.get(ref);
    if (!id)
      throw new ApxError({ code: "bad_request", message: `ref ${ref} is stale or unknown: take a new snapshot` });
    return id;
  }

  async #center(ref: string): Promise<{ x: number; y: number }> {
    const backendNodeId = this.#backend(ref);
    await this.#send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const { quads } = await this.#send<{ quads: number[][] }>("DOM.getContentQuads", { backendNodeId });
    const q = quads[0];
    if (!q || q.length < 8) throw new ApxError({ code: "bad_request", message: `ref ${ref} is not visible` });
    const xs = [q[0], q[2], q[4], q[6]] as number[];
    const ys = [q[1], q[3], q[5], q[7]] as number[];
    return { x: xs.reduce((a, b) => a + b) / 4, y: ys.reduce((a, b) => a + b) / 4 };
  }

  async #assertNotCredentialField(backendNodeId: number): Promise<void> {
    const { node } = await this.#send<{ node: { nodeName: string; attributes?: string[] } }>("DOM.describeNode", {
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
    await this.#send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      ...base,
      ...(text ? { text } : {}),
      ...(commands ? { commands } : {}),
    });
    await this.#send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ApxError({ code: "timeout", message: `timed out after ${ms}ms` })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
