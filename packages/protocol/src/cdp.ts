// Driving one page over the Chrome DevTools Protocol, the same way wherever the page lives: the desktop app's tabs
// (Electron's debugger) or the core's own headless Chrome. Refs are backendNodeIds from the accessibility tree
// (stable while the document lives, DOM untouched).
import type { BrowserDialog, BrowserFillSecret, ElementEdit, PickedElement, SignInResult } from "./browser.ts";
import { isDialogRef, PageDialog } from "./cdp-dialog.ts";
import { PageEdits } from "./cdp-edit.ts";
import { captureDocument, evaluatePage } from "./cdp-evaluate.ts";
import { SecretFields } from "./cdp-fill.ts";

export { scrubDeep } from "./cdp-fill.ts";

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
/** The first `max` UTF-16 units of `s`, never ending on half an emoji (a lone surrogate fails a model request). */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const code = s.charCodeAt(max - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

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
  #epoch = crypto.randomUUID();
  #review: { document: string; epoch: string } | undefined;
  readonly #edits: PageEdits;
  readonly #secrets: SecretFields;
  readonly #dialog: PageDialog;

  /**
   * `selectAllModifiers`: the modifier bits for "select all" on the machine the page runs on (Meta=4 on a Mac).
   * `dialogAnswered`: called after the agent answered a JavaScript dialog.
   */
  constructor(send: CdpSend, opts: { selectAllModifiers: number; dialogAnswered?: () => void }) {
    this.#send = send;
    this.#selectAll = opts.selectAllModifiers;
    this.#edits = new PageEdits(send);
    this.#secrets = new SecretFields(send);
    this.#dialog = new PageDialog(send, opts.dialogAnswered);
  }

  /** The page's CDP events, as they come: a JavaScript dialog is known only from them. */
  onEvent(method: string, params: unknown): void {
    this.#dialog.onEvent(method, params);
  }

  /** The JavaScript dialog the page waits on, if any. */
  get dialog(): BrowserDialog | undefined {
    return this.#dialog.kind;
  }

  /** Refuses anything that runs in the page while a dialog holds it: it would wait until someone answers. */
  assertNoDialog(): void {
    this.#dialog.assertClosed();
  }

  get consentEpoch(): string {
    return this.#epoch;
  }

  /**
   * A new document, or a new address in the same one (`sameDocument`): the refs of the last snapshot point at nothing
   * now. A field filled from a secret stays protected while its document lives.
   */
  forget(sameDocument = false): void {
    if (!sameDocument) this.#secrets.forget();
    this.#refs.clear();
    this.#edits.forget();
    this.#review = undefined;
    this.#epoch = crypto.randomUUID();
  }

  /** Whether this document holds a value filled from a stored secret: pictures of it must cover it. */
  get holdsSecret(): boolean {
    return this.#secrets.holds;
  }

  /** Refuses any read of a page that copied a secret's value, until the tab leaves it. */
  assertReadable(): void {
    if (this.#secrets.leaked)
      throw new ApxError({
        code: "credential_field",
        message: "this page copied a secret's value: it is not shown until the tab goes to another page",
      });
  }

  /** Text read from the page with any secret's value filled into it taken out. */
  scrub(text: string): string {
    return this.#secrets.scrub(text);
  }

  #assertNoSecret(): void {
    // For the tab's life: going back may bring the filled page back as it was.
    if (this.#secrets.held || this.#secrets.leaked)
      throw new ApxError({
        code: "credential_field",
        message: "a secret was filled in this tab: page JavaScript is not run in it; open another tab",
      });
  }

  /** Puts a value the core resolved from a stored secret into a sign-in field. See DECISIONS.md#d-193 */
  fillSecret(ref: string, req: Pick<BrowserFillSecret, "kind" | "origins" | "value">): Promise<SignInResult> {
    this.assertNoDialog();
    const backendNodeId = this.#backend(ref);
    return withTimeout(this.#secrets.fill(backendNodeId, req), 10_000);
  }

  async approvalContext(origin: string, document: string): Promise<{ epoch: string }> {
    this.#assertNoSecret();
    this.assertNoDialog();
    const epoch = this.#epoch;
    if (this.#review?.document !== document || this.#review.epoch !== epoch)
      throw new ApxError({ code: "bad_request", message: "Page review changed; take a new snapshot" });
    await withTimeout(evaluatePage(this.#send, "null", origin, document), 7_000);
    this.#assertEpoch(epoch);
    return { epoch };
  }

  #assertEpoch(epoch: string): void {
    if (epoch !== this.#epoch)
      throw new ApxError({ code: "bad_request", message: "Browser permission expired; inspect and approve again" });
  }

  async snapshot(maxChars: number): Promise<{ tree: string; refs: number; truncated: boolean; document: string }> {
    this.assertReadable();
    if (this.#dialog.kind) {
      this.#review = undefined;
      return { ...this.#dialog.tree(clip, (s) => this.#secrets.scrub(s)), truncated: false, document: "" };
    }
    const epoch = this.#epoch;
    const document = await captureDocument(this.#send);
    this.#review = { document, epoch };
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
        let line = `${"  ".repeat(depth)}- ${role}${name ? ` "${clip(name, 100)}"` : ""}`;
        if (node.backendDOMNodeId && (INTERACTIVE.test(role) || role === "heading" || role === "img")) {
          const ref = `e${++i}`;
          this.#refs.set(ref, node.backendDOMNodeId);
          line += ` [${ref}]`;
        }
        const value = node.value?.value;
        if (node.backendDOMNodeId && this.#secrets.isFilled(node.backendDOMNodeId)) line += " (filled by APX)";
        else if (value !== undefined && value !== "") line += ` = "${clip(String(value), 60)}"`;
        line = this.#secrets.scrub(line);
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
    return { tree: lines.join("\n"), refs: i, truncated, document };
  }

  evaluate(script: string, origin: string, document: string, epoch?: string) {
    this.#assertNoSecret();
    this.assertNoDialog();
    if (epoch !== undefined) {
      this.#assertEpoch(epoch);
      if (this.#review?.document !== document || this.#review.epoch !== epoch)
        throw new ApxError({ code: "bad_request", message: "Page review changed; take a new snapshot" });
    }
    return withTimeout(evaluatePage(this.#send, script, origin, document), 7_000);
  }

  /** Edit mode: the element under a point of the visible page, as fractions of it. */
  inspect(x: number, y: number, whole?: { height: number }): Promise<PickedElement | null> {
    this.assertNoDialog();
    return withTimeout(this.#edits.inspect(x, y, whole), 4_000);
  }

  /** Edit mode: these edits shown in the page until it reloads, the earlier ones undone. */
  previewEdits(edits: readonly ElementEdit[]): Promise<{ shown: number }> {
    this.assertNoDialog();
    return withTimeout(this.#edits.show(edits), 6_000);
  }

  /** Returns the JavaScript dialog the click opened, if it did: the page then waits for its answer. */
  async click(ref: string): Promise<BrowserDialog | undefined> {
    if (isDialogRef(ref)) {
      await withTimeout(this.#dialog.click(ref), 4_000);
      return undefined;
    }
    this.assertNoDialog();
    const { x, y } = await this.#center(ref);
    const press = { x, y, button: "left", clickCount: 1 };
    return (
      (await this.#input("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })) ??
      (await this.#input("Input.dispatchMouseEvent", { type: "mousePressed", ...press })) ??
      this.#input("Input.dispatchMouseEvent", { type: "mouseReleased", ...press })
    );
  }

  /** Returns the JavaScript dialog typing opened (a key handler, a form sent with Enter), if it did. */
  async type(ref: string, text: string, submit: boolean): Promise<BrowserDialog | undefined> {
    if (isDialogRef(ref)) {
      await withTimeout(this.#dialog.type(ref, text, submit), 4_000);
      return undefined;
    }
    this.assertNoDialog();
    const backendNodeId = this.#backend(ref);
    await this.#assertNotCredentialField(backendNodeId);
    await this.#send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    // Select existing content so the new text replaces it, like a user would.
    const steps: Array<() => Promise<BrowserDialog | undefined>> = [
      () => this.#input("DOM.focus", { backendNodeId }),
      () => this.#key("a", "KeyA", 65, this.#selectAll, undefined, ["selectAll"]),
      () => this.#input("Input.insertText", { text }),
      ...(submit ? [() => this.#key("Enter", "Enter", 13, 0, "\r")] : []),
    ];
    for (const step of steps) {
      const opened = await step();
      if (opened) return opened;
    }
    return undefined;
  }

  /** An input command that the page answers, unless it opens a dialog first (then it answers once that closes). */
  #input(method: string, params: object): Promise<BrowserDialog | undefined> {
    return this.#dialog.input(this.#send(method, params));
  }

  /** A JPEG of what the page shows (base64), at most SHOT_WIDTH pixels wide, bounded in time. */
  async screenshot(timeoutMs = 4_000): Promise<string> {
    this.assertReadable();
    this.assertNoDialog();
    const shoot = async () => {
      const clip = await this.#viewportClip().catch(() => undefined);
      return this.#send<{ data: string }>("Page.captureScreenshot", {
        format: "jpeg",
        quality: 70,
        optimizeForSpeed: true,
        ...(clip ? { clip, captureBeyondViewport: false } : {}),
      });
    };
    const { data } = await withTimeout(this.#secrets.holds ? this.#secrets.masked(shoot) : shoot(), timeoutMs);
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
    const opened = await this.#input("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      ...base,
      ...(text ? { text } : {}),
      ...(commands ? { commands } : {}),
    });
    return opened ?? this.#input("Input.dispatchKeyEvent", { type: "keyUp", ...base });
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
