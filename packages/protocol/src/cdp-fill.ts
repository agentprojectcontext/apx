// Filling a sign-in field from a stored secret the agent never sees (DECISIONS.md#d-193). The site, the field's frame
// and its kind are read from CDP (frame tree, DOM), never from page JavaScript; the value goes in as typed text, and
// the reads after it run in an isolated world the page's scripts cannot reach.
import { type BrowserFillSecret, type SecretFieldKind, type SignInResult, siteAllowed, siteOrigin } from "./browser.ts";
import type { CdpSend } from "./cdp.ts";

type FrameTree = { frame: { id: string; url: string; securityOrigin?: string }; childFrames?: FrameTree[] };
type DomNode = {
  backendNodeId: number;
  nodeName: string;
  attributes?: string[];
  frameId?: string;
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
};

/** What the field is, as the page declares it: `card` and anything not a sign-in field are never filled. */
export type FieldKind = SecretFieldKind | "card" | "other";

/** Shorter values would match ordinary page text: they are not looked for elsewhere. */
const SCAN_MIN = 4;
/** Time the page gets to react to the typed value before it is looked for elsewhere. */
const SETTLE_MS = 250;
const WORLD = "apx-sign-in";

const attrsOf = (n: DomNode): Map<string, string> => {
  const m = new Map<string, string>();
  const raw = n.attributes ?? [];
  for (let k = 0; k + 1 < raw.length; k += 2) m.set(String(raw[k]).toLowerCase(), String(raw[k + 1]));
  return m;
};

const isPassword = (n: DomNode) =>
  n.nodeName === "INPUT" && (attrsOf(n).get("type") ?? "").toLowerCase() === "password";

/** The kind of a field from its own attributes and whether its form (or document) asks for a password too. */
export function fieldKind(node: DomNode, besidePassword: boolean): FieldKind {
  if (node.nodeName !== "INPUT") return "other";
  const a = attrsOf(node);
  if (a.has("disabled") || a.has("readonly")) return "other";
  const type = (a.get("type") ?? "text").toLowerCase() || "text";
  const auto = (a.get("autocomplete") ?? "").toLowerCase().split(/\s+/);
  if (auto.some((t) => t.startsWith("cc-"))) return "card";
  if (type === "password" || auto.includes("current-password") || auto.includes("new-password")) return "password";
  if (auto.includes("one-time-code")) return "otp";
  if (!["text", "email", "tel"].includes(type)) return "other";
  if (auto.includes("username") || auto.includes("email") || type === "email") return "username";
  return besidePassword ? "username" : "other";
}

type Found = { node: DomNode; frameId: string; besidePassword: boolean };

/** Finds the node in the frame's tree (shadow roots and same-process frames included) with its frame and form. */
function locate(root: DomNode, frameId: string, backendNodeId: number): Found | undefined {
  const walk = (n: DomNode, frame: string, form: DomNode | undefined, doc: DomNode): Found | undefined => {
    if (n.backendNodeId === backendNodeId) {
      const scope = form ?? doc;
      return { node: n, frameId: frame, besidePassword: hasPassword(scope) };
    }
    const inForm = n.nodeName === "FORM" ? n : form;
    for (const c of [...(n.shadowRoots ?? []), ...(n.children ?? [])]) {
      const hit = walk(c, frame, inForm, doc);
      if (hit) return hit;
    }
    if (n.contentDocument) return walk(n.contentDocument, n.frameId ?? frame, undefined, n.contentDocument);
    return undefined;
  };
  return walk(root, frameId, undefined, root);
}

function hasPassword(n: DomNode): boolean {
  if (isPassword(n)) return true;
  return [...(n.shadowRoots ?? []), ...(n.children ?? [])].some(hasPassword);
}

function originsOf(tree: FrameTree, into = new Map<string, string>()): Map<string, string> {
  into.set(tree.frame.id, tree.frame.securityOrigin ?? siteOrigin(tree.frame.url) ?? "null");
  for (const c of tree.childFrames ?? []) originsOf(c, into);
  return into;
}

const KIND_WORDS: Record<FieldKind, string> = {
  password: "a password",
  username: "a username",
  otp: "a one-time code",
  card: "card data",
  other: "something other than a sign-in value",
};

/** Looks for the value outside the field, in every document of the frame's window it can reach, and clears it. */
const SCAN = `function(secret) {
  const self = this;
  let leaks = 0;
  const docs = new Set();
  const add = (w) => { try { if (w.document) docs.add(w.document); for (let i = 0; i < w.frames.length; i++) add(w.frames[i]); } catch {} };
  add(self.ownerDocument.defaultView.top);
  docs.add(self.ownerDocument);
  const visit = (root) => {
    const walker = root.ownerDocument ? root.ownerDocument.createTreeWalker(root, 5) : root.createTreeWalker(root, 5);
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        if (n.data.includes(secret)) { leaks++; n.data = n.data.split(secret).join(''); }
        continue;
      }
      if (n.nodeType !== 1) continue;
      for (const a of [...n.attributes]) if (a.value.includes(secret)) { leaks++; n.removeAttribute(a.name); }
      if (n !== self && typeof n.value === 'string' && n.value.includes(secret)) { leaks++; n.value = ''; }
      if (n.shadowRoot) visit(n.shadowRoot);
    }
  };
  for (const d of docs) {
    visit(d);
    try {
      const href = d.defaultView.location.href;
      if (href.includes(secret)) { leaks++; d.defaultView.history.replaceState(null, '', href.split(secret).join('')); }
    } catch {}
  }
  if (leaks) self.value = '';
  return leaks;
}`;

/** Puts the value in the field as typing would, with the browser's own setter, and tells the page it changed. */
const SET = `function(value) {
  this.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(this, value);
  this.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}`;

/** The style that hides what a filled field shows while a picture of the page is taken. */
const MASK = `function(on) {
  const props = ['color', '-webkit-text-fill-color', '-webkit-text-security', 'text-shadow', 'caret-color'];
  if (on) {
    this.__apxMask = props.map((p) => [p, this.style.getPropertyValue(p), this.style.getPropertyPriority(p)]);
    this.style.setProperty('color', 'transparent', 'important');
    this.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    this.style.setProperty('-webkit-text-security', 'disc', 'important');
    this.style.setProperty('text-shadow', 'none', 'important');
    this.style.setProperty('caret-color', 'transparent', 'important');
  } else if (this.__apxMask) {
    for (const [p, v, prio] of this.__apxMask) v ? this.style.setProperty(p, v, prio) : this.style.removeProperty(p);
    delete this.__apxMask;
  }
}`;

/** A result with every string run through `scrub`: what a tab answers the core, minus any value filled in it. */
export function scrubDeep<T>(value: T, scrub: (text: string) => string): T {
  if (typeof value === "string") return scrub(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, scrub)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, scrub)])) as T;
  return value;
}

const refused = (origin: string, reason: string): SignInResult => ({ outcome: "refused", origin, reason });

/**
 * One tab's filled fields while their document lives (what pictures cover), and the values filled in the tab while it
 * lives: what snapshots, text, addresses and titles leave out, and why page JavaScript never runs there again.
 */
export class SecretFields {
  readonly #send: CdpSend;
  #filled = new Map<number, string>();
  /** The values put in this tab: a page may carry one on (a form sent by GET, an error page, going back). */
  #values = new Set<string>();
  #leaked = false;

  constructor(send: CdpSend) {
    this.#send = send;
  }

  /** Whether this document holds a value from a stored secret: JavaScript and unmasked pictures wait. */
  get holds(): boolean {
    return this.#filled.size > 0 || this.#leaked;
  }

  /** A value was ever filled in this tab: its JavaScript stays refused until the tab is closed. */
  get held(): boolean {
    return this.#values.size > 0;
  }

  /** The page copied a value: nothing of it reaches the agent until the tab leaves it. */
  get leaked(): boolean {
    return this.#leaked;
  }

  /** A new document: its fields are new nodes. The values stay scrubbed for the tab's life. */
  forget(): void {
    this.#filled.clear();
    this.#leaked = false;
  }

  isFilled(backendNodeId: number): boolean {
    return this.#filled.has(backendNodeId);
  }

  /** Text the agent reads, with any value filled in this tab taken out. */
  scrub(text: string): string {
    let out = text;
    for (const v of this.#values) if (v.length >= SCAN_MIN) out = out.split(v).join("[secret]");
    return out;
  }

  async fill(backendNodeId: number, req: Pick<BrowserFillSecret, "kind" | "origins" | "value">): Promise<SignInResult> {
    const top = await this.#top();
    if (!top.origin || !siteAllowed(req.origins, top.origin))
      return refused(top.origin ?? "", `this page is on ${top.origin || "no site"}, not a site this secret is for`);
    const { root } = await this.#send<{ root: DomNode }>("DOM.getDocument", { depth: -1, pierce: true });
    const found = locate(root, top.frameId, backendNodeId);
    if (!found) return refused(top.origin, "the field is not in this page (or is inside a frame from another site)");
    if (top.frames.get(found.frameId) !== top.origin)
      return refused(top.origin, "the field is inside a frame from another site");
    const kind = fieldKind(found.node, found.besidePassword);
    if (kind !== req.kind)
      return refused(top.origin, `this field takes ${KIND_WORDS[kind]}, and the secret is for ${KIND_WORDS[req.kind]}`);
    const objectId = await this.#resolve(backendNodeId, found.frameId);
    await this.#send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
    // Checked again right before the value goes in: the page may have moved on.
    const now = await this.#top();
    if (now.origin !== top.origin) return refused(now.origin ?? "", "the page changed before the field was filled");
    // Protected before the value goes in: a picture taken meanwhile already covers the field.
    this.#filled.set(backendNodeId, found.frameId);
    this.#values.add(req.value);
    // Set on that very node, not typed: wherever the page moves the focus, the value goes nowhere else.
    if (!(await this.#call<boolean>(objectId, SET, [req.value]).catch(() => false))) {
      this.#filled.delete(backendNodeId);
      return refused(top.origin, "the field did not take the value");
    }
    if (req.value.length < SCAN_MIN) return { outcome: "filled", origin: top.origin };
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const leaks = await this.#call<number>(objectId, SCAN, [req.value]).catch(() => 0);
    if (leaks > 0) {
      this.#leaked = true;
      return { ...refused(top.origin, "the page copied the value elsewhere; it was cleared"), leaked: true };
    }
    return { outcome: "filled", origin: top.origin };
  }

  /** Runs `capture` with every filled field showing nothing of its value. */
  async masked<T>(capture: () => Promise<T>): Promise<T> {
    const objects: string[] = [];
    for (const [backendNodeId, frameId] of this.#filled) {
      const id = await this.#resolve(backendNodeId, frameId).catch(() => undefined);
      if (!id) continue;
      await this.#call(id, MASK, [true]);
      objects.push(id);
    }
    try {
      return await capture();
    } finally {
      for (const id of objects) await this.#call(id, MASK, [false]).catch(() => {});
    }
  }

  async #top(): Promise<{ frameId: string; origin: string | undefined; frames: Map<string, string> }> {
    const { frameTree } = await this.#send<{ frameTree: FrameTree }>("Page.getFrameTree");
    const frames = originsOf(frameTree);
    const url = siteOrigin(frameTree.frame.url);
    const origin = url && frames.get(frameTree.frame.id) === url ? url : undefined;
    return { frameId: frameTree.frame.id, origin, frames };
  }

  async #resolve(backendNodeId: number, frameId: string): Promise<string> {
    const { executionContextId } = await this.#send<{ executionContextId: number }>("Page.createIsolatedWorld", {
      frameId,
      worldName: WORLD,
    });
    const { object } = await this.#send<{ object: { objectId?: string } }>("DOM.resolveNode", {
      backendNodeId,
      executionContextId,
    });
    if (!object.objectId) throw new Error("the field is gone");
    return object.objectId;
  }

  async #call<T>(objectId: string, fn: string, args: unknown[] = []): Promise<T> {
    const r = await this.#send<{ result: { value?: unknown }; exceptionDetails?: unknown }>("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: fn,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error("the page did not answer");
    return r.result.value as T;
  }
}
