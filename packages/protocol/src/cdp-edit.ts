// The owner's edit mode on a page: what element lies under a point, and changes shown only in their view until the
// page reloads. Plain DOM and CSS commands: no script runs in the page, so it cannot fake a pick or see the edits.

import { EDIT_ELEMENTS_MAX, type ElementEdit, type ElementKind, type PickedElement } from "./browser.ts";
import type { CdpSend } from "./cdp.ts";
import { ApxError } from "./client.ts";

type DescribedNode = {
  /** Set when the node came from DOM.getDocument (0 from DOM.describeNode). */
  nodeId?: number;
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue?: string;
  backendNodeId: number;
  attributes?: string[];
  children?: DescribedNode[];
};

/** Elements whose text is not theirs to rewrite: form fields, media, the document itself. */
const NO_TEXT = /^(input|textarea|select|option|img|video|audio|iframe|svg|canvas|html|body|head)$/;
const SKIP = /^(html|body|head)$/;
const CREDENTIAL_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/;
const TEXT_MAX = 500;
const NAME_MAX = 120;
/** What the page never draws as a part to change, nor anything inside it. */
const UNLISTED =
  /^(head|script|style|noscript|template|title|meta|link|base|svg|math|canvas|iframe|frame|object|embed|video|audio|map|datalist|option|optgroup)$/;
const FIELD = /^(input|textarea|select)$/;
/** The most nodes looked at for a list, so a huge page answers in time. */
const CANDIDATES_MAX = 2_000;

type Metrics = {
  cssVisualViewport?: { clientWidth: number; clientHeight: number; pageX?: number; pageY?: number };
  cssContentSize?: { width: number; height: number };
};
/** What box fractions are of: `fw`×`fh` CSS pixels from `origin` of the document, seen scrolled by `scroll`. */
type Frame = { fw: number; fh: number; origin: { x: number; y: number }; scroll: { x: number; y: number } };

function frameOf(m: Metrics, whole?: { height: number }): Omit<Frame, "scroll"> {
  const vw = m.cssVisualViewport?.clientWidth ?? 0;
  const vh = m.cssVisualViewport?.clientHeight ?? 0;
  if (!vw || !vh) throw new ApxError({ code: "unavailable", message: "the page has no size yet" });
  return {
    fw: whole ? Math.max(vw, m.cssContentSize?.width ?? 0) : vw,
    fh: whole ? Math.max(vh, Math.min(whole.height, m.cssContentSize?.height ?? 0)) : vh,
    origin: whole ? { x: 0, y: 0 } : scrollOf(m),
  };
}

const scrollOf = (m: Metrics) => ({ x: m.cssVisualViewport?.pageX ?? 0, y: m.cssVisualViewport?.pageY ?? 0 });

/** A box kept on the frame's top and left edges, as the owner sees it there. */
function clampBox(b: NonNullable<PickedElement["box"]>): PickedElement["box"] {
  return { ...b, x: Math.max(0, b.x), y: Math.max(0, b.y) };
}

const tagOf = (node: DescribedNode) => (node.localName ?? node.nodeName).toLowerCase();

/** A title, button or link by its tag or its own `role`, else undefined. */
function ownKind(tag: string, attrs: Map<string, string>): ElementKind | undefined {
  const role = (attrs.get("role") ?? "").toLowerCase();
  if (/^h[1-6]$/.test(tag) || role === "heading") return "heading";
  if (tag === "button" || role === "button" || role === "menuitem" || role === "tab") return "button";
  if ((tag === "a" && attrs.has("href")) || role === "link") return "link";
  return undefined;
}

/** What an element is to the owner, from its tag, its attributes and the role the page gives it. */
function kindOf(tag: string, attrs: Map<string, string>, axRole = ""): ElementKind {
  if (axRole === "heading") return "heading";
  if (axRole === "button") return "button";
  if (axRole === "link") return "link";
  if (tag === "img" || axRole === "image" || axRole === "img") return "image";
  if (FIELD.test(tag)) return "field";
  return ownKind(tag, attrs) ?? "text";
}

/**
 * The elements a list offers, in page order: each element showing one text of its own (named for the title, button or
 * link it is in), each picture and field, and a title, button or link with nothing of that inside (an icon button).
 */
function candidatesOf(root: DescribedNode): Array<{ node: DescribedNode; kind?: ElementKind }> {
  const out: Array<{ node: DescribedNode; kind?: ElementKind }> = [];
  const visit = (node: DescribedNode, inherited: ElementKind | undefined): boolean => {
    if (out.length >= CANDIDATES_MAX) return true;
    if (node.nodeType !== 1) {
      let listed = false;
      if (node.nodeType === 9 || node.nodeType === 11)
        for (const c of node.children ?? []) listed = visit(c, inherited) || listed;
      return listed;
    }
    const tag = tagOf(node);
    const attrs = attributesOf(node);
    if (UNLISTED.test(tag) || attrs.has("hidden") || attrs.get("aria-hidden") === "true") return false;
    if (tag === "img" || FIELD.test(tag)) {
      if (tag === "input" && (attrs.get("type") ?? "").toLowerCase() === "hidden") return false;
      out.push({ node, kind: tag === "img" ? "image" : "field" });
      return true;
    }
    const own = ownKind(tag, attrs);
    if (!SKIP.test(tag) && soleText(node)) {
      out.push(inherited ? { node, kind: inherited } : { node });
      return true;
    }
    const at = out.length;
    let listed = false;
    for (const c of node.children ?? []) listed = visit(c, inherited ?? own) || listed;
    if (own && !inherited && !listed && !SKIP.test(tag)) {
      out.splice(at, 0, { node, kind: own });
      return true;
    }
    return listed;
  };
  visit(root, undefined);
  return out;
}

/** Attributes as a map, names lowercased. */
function attributesOf(node: DescribedNode): Map<string, string> {
  const out = new Map<string, string>();
  const raw = node.attributes ?? [];
  for (let k = 0; k + 1 < raw.length; k += 2) out.set(String(raw[k]).toLowerCase(), String(raw[k + 1]));
  return out;
}

/** A short CSS selector a person or agent can search the code for: tag, id or up to three classes. */
export function selectorOf(tag: string, attrs: Map<string, string>): string {
  const id = attrs.get("id") ?? "";
  if (/^[A-Za-z][\w-]*$/.test(id)) return `${tag}#${id}`;
  const classes = (attrs.get("class") ?? "")
    .split(/\s+/)
    .filter((c) => /^[A-Za-z_-][\w-]*$/.test(c))
    .slice(0, 3);
  return classes.length ? `${tag}.${classes.join(".")}` : tag;
}

/** The single text a node shows when it has no other children, else undefined. */
function soleText(node: DescribedNode): DescribedNode | undefined {
  const kids = node.children ?? [];
  const texts = kids.filter((c) => c.nodeType === 3 && (c.nodeValue ?? "").trim());
  if (texts.length !== 1 || kids.some((c) => c.nodeType === 1)) return undefined;
  return texts[0];
}

/** `style` declarations for an edit; values were checked by the protocol, so they cannot break out of a declaration. */
export function styleOf(edit: ElementEdit["style"]): string {
  if (!edit) return "";
  const parts: string[] = [];
  if (edit.color) parts.push(`color: ${edit.color} !important`);
  if (edit.background) parts.push(`background-color: ${edit.background} !important`);
  if (edit.font_size !== undefined) parts.push(`font-size: ${edit.font_size}px !important`);
  if (edit.padding !== undefined) parts.push(`padding: ${edit.padding}px !important`);
  return parts.join("; ");
}

type Original = { style: string | null; text?: { backendNodeId: number; value: string } };

export class PageEdits {
  readonly #send: CdpSend;
  /** What each edited element had before, by backend node id: the edits are undone from it. */
  #originals = new Map<number, Original>();

  constructor(send: CdpSend) {
    this.#send = send;
  }

  /** A new document: its nodes are gone, and so are the edits. */
  forget(): void {
    this.#originals.clear();
  }

  get count(): number {
    return this.#originals.size;
  }

  /**
   * The element under a point given as fractions of the visible page (0–1), or null over nothing editable. With
   * `whole`, the fractions (and the box) are of the whole page down to `whole.height` CSS pixels instead.
   */
  async inspect(fx: number, fy: number, whole?: { height: number }): Promise<PickedElement | null> {
    let m = await this.#send<Metrics>("Page.getLayoutMetrics");
    const { fw, fh, origin } = frameOf(m, whole);
    const x = Math.round(origin.x + fx * fw);
    const y = Math.round(origin.y + fy * fh);
    const doc = await this.#send<{ root?: DescribedNode }>("DOM.getDocument", { depth: whole ? 1 : 0 });
    if (whole) {
      // Only what is on screen can be hit: a DOM command scrolls the point into view, not the page's own code.
      const html = doc.root?.children?.find((n) => n.nodeType === 1);
      if (html)
        await this.#send("DOM.scrollIntoViewIfNeeded", {
          backendNodeId: html.backendNodeId,
          rect: { x, y, width: 1, height: 1 },
        }).catch(() => {});
      m = await this.#send<Metrics>("Page.getLayoutMetrics");
    }
    const frame = { fw, fh, origin, scroll: scrollOf(m) };
    const hit = await this.#send<{ backendNodeId: number }>("DOM.getNodeForLocation", {
      x,
      y,
      ignorePointerEventsNone: true,
    }).catch(() => undefined);
    if (!hit) return null;
    const { node } = await this.#send<{ node: DescribedNode }>("DOM.describeNode", {
      backendNodeId: hit.backendNodeId,
      depth: 1,
    });
    if (node.nodeType !== 1) return null;
    const tag = tagOf(node);
    if (SKIP.test(tag)) return null;
    const raw = await this.#box(node.backendNodeId, frame);
    return this.#describe(node, raw && clampBox(raw), undefined);
  }

  /**
   * The parts of the page the owner can pick, in page order: each text a part shows on its own, pictures, fields, and
   * a title, button or link with no such text inside. Parts the page does not draw are left out; one outside the
   * frame (the visible page, or the whole page with `whole`) has no box.
   */
  async list(whole?: { height: number }, max = EDIT_ELEMENTS_MAX): Promise<PickedElement[]> {
    const m = await this.#send<Metrics>("Page.getLayoutMetrics");
    const frame = { ...frameOf(m, whole), scroll: scrollOf(m) };
    const doc = await this.#send<{ root?: DescribedNode }>("DOM.getDocument", { depth: -1 });
    const found = doc.root ? candidatesOf(doc.root) : [];
    await this.#send("CSS.enable").catch(() => {});
    const out: PickedElement[] = [];
    for (const { node, kind } of found) {
      if (out.length >= max) break;
      const raw = await this.#box(node.backendNodeId, frame);
      // Not drawn (hidden, or nothing to see): there is nothing to point at.
      if (!raw || raw.width <= 0 || raw.height <= 0) continue;
      const inFrame = raw.x < 1 && raw.y < 1 && raw.x + raw.width > 0 && raw.y + raw.height > 0;
      out.push(await this.#describe(node, inFrame ? clampBox(raw) : null, kind, true));
    }
    return out;
  }

  /** What edit mode tells of an element, from its node with its children (`depth: 1` or more). */
  async #describe(
    node: DescribedNode,
    box: PickedElement["box"],
    kind: ElementKind | undefined,
    cssReady = false,
  ): Promise<PickedElement> {
    const tag = tagOf(node);
    const attrs = attributesOf(node);
    const sensitive =
      (attrs.get("type") ?? "").toLowerCase() === "password" ||
      CREDENTIAL_AUTOCOMPLETE.test((attrs.get("autocomplete") ?? "").toLowerCase());
    const textNode = NO_TEXT.test(tag) ? undefined : soleText(node);
    // An edit already shown is what the owner sees; the original text is what the page's code says.
    const shown = this.#originals.get(node.backendNodeId)?.text?.value ?? textNode?.nodeValue;
    const ax = await this.#send<{ nodes: Array<{ role?: { value?: string }; name?: { value?: string } }> }>(
      "Accessibility.getPartialAXTree",
      { backendNodeId: node.backendNodeId, fetchRelatives: false },
    ).catch(() => ({ nodes: [] }));
    const role = String(ax.nodes[0]?.role?.value ?? "");
    const name = String(ax.nodes[0]?.name?.value ?? "").trim();
    const style = await this.#computed(node.backendNodeId, node.nodeId, cssReady);
    return {
      node: node.backendNodeId,
      tag,
      role: role && role !== "generic" && role !== "none" ? role : "",
      name: sensitive ? "" : name.slice(0, NAME_MAX),
      selector: selectorOf(tag, attrs),
      kind: kind ?? kindOf(tag, attrs, role),
      text: sensitive || shown === undefined ? null : shown.trim().slice(0, TEXT_MAX),
      sensitive,
      box,
      style,
    };
  }

  /** Where an element sits, as fractions of the frame; unclamped, so a part outside it shows as such. */
  async #box(backendNodeId: number, f: Frame): Promise<PickedElement["box"]> {
    const box = await this.#send<{ model: { border: number[] } }>("DOM.getBoxModel", { backendNodeId }).catch(
      () => undefined,
    );
    // Box quads are in the visible page's coordinates; the frame starts at `origin` of the document.
    const q = box?.model.border ?? [];
    const xs = [q[0], q[2], q[4], q[6]]
      .filter((v): v is number => v !== undefined)
      .map((v) => v + f.scroll.x - f.origin.x);
    const ys = [q[1], q[3], q[5], q[7]]
      .filter((v): v is number => v !== undefined)
      .map((v) => v + f.scroll.y - f.origin.y);
    if (!xs.length || !ys.length) return null;
    return {
      x: Math.min(...xs) / f.fw,
      y: Math.min(...ys) / f.fh,
      width: (Math.max(...xs) - Math.min(...xs)) / f.fw,
      height: (Math.max(...ys) - Math.min(...ys)) / f.fh,
    };
  }

  async #computed(backendNodeId: number, known?: number, cssReady = false): Promise<PickedElement["style"]> {
    try {
      if (!cssReady) await this.#send("CSS.enable");
      const nodeId = known || (await this.#nodeId(backendNodeId));
      if (!nodeId) return {};
      const { computedStyle } = await this.#send<{ computedStyle: Array<{ name: string; value: string }> }>(
        "CSS.getComputedStyleForNode",
        { nodeId },
      );
      const get = (n: string) => computedStyle.find((s) => s.name === n)?.value ?? "";
      const px = (v: string) => {
        const n = Number.parseFloat(v);
        return Number.isFinite(n) ? Math.round(n) : undefined;
      };
      return {
        color: get("color") || undefined,
        background: get("background-color") || undefined,
        font_size: px(get("font-size")),
        padding: px(get("padding-top")),
      };
    } catch {
      return {};
    }
  }

  /**
   * Shows exactly these edits: elements edited before and not listed go back to what they were. An empty list
   * undoes everything. Text is set on the element's own text node, style through its `style` attribute.
   */
  async show(edits: readonly ElementEdit[]): Promise<{ shown: number }> {
    await this.#send("DOM.getDocument", { depth: 0 });
    for (const [backendNodeId, original] of this.#originals) await this.#restore(backendNodeId, original);
    this.#originals.clear();
    for (const edit of edits) {
      const { node } = await this.#send<{ node: DescribedNode }>("DOM.describeNode", {
        backendNodeId: edit.node,
        depth: 1,
      }).catch(() => ({ node: undefined }));
      if (node?.nodeType !== 1) continue;
      const tag = (node.localName ?? node.nodeName).toLowerCase();
      if (SKIP.test(tag)) continue;
      const attrs = attributesOf(node);
      const original: Original = { style: attrs.has("style") ? (attrs.get("style") ?? "") : null };
      const nodeId = await this.#nodeId(edit.node);
      if (!nodeId) continue;
      const added = styleOf(edit.style);
      if (added) {
        const base = (original.style ?? "").trim().replace(/;\s*$/, "");
        await this.#send("DOM.setAttributeValue", { nodeId, name: "style", value: base ? `${base}; ${added}` : added });
      }
      const textNode = edit.text !== undefined && !NO_TEXT.test(tag) ? soleText(node) : undefined;
      if (textNode && edit.text !== undefined) {
        const textId = await this.#nodeId(textNode.backendNodeId);
        if (textId) {
          original.text = { backendNodeId: textNode.backendNodeId, value: textNode.nodeValue ?? "" };
          await this.#send("DOM.setNodeValue", { nodeId: textId, value: edit.text });
        }
      }
      this.#originals.set(edit.node, original);
    }
    return { shown: this.#originals.size };
  }

  async #restore(backendNodeId: number, original: Original): Promise<void> {
    const nodeId = await this.#nodeId(backendNodeId);
    if (!nodeId) return;
    if (original.style === null) await this.#send("DOM.removeAttribute", { nodeId, name: "style" }).catch(() => {});
    else await this.#send("DOM.setAttributeValue", { nodeId, name: "style", value: original.style }).catch(() => {});
    if (original.text) {
      const textId = await this.#nodeId(original.text.backendNodeId);
      if (textId) await this.#send("DOM.setNodeValue", { nodeId: textId, value: original.text.value }).catch(() => {});
    }
  }

  async #nodeId(backendNodeId: number): Promise<number | undefined> {
    const r = await this.#send<{ nodeIds: number[] }>("DOM.pushNodesByBackendIdsToFrontend", {
      backendNodeIds: [backendNodeId],
    }).catch(() => undefined);
    return r?.nodeIds[0] || undefined;
  }
}
