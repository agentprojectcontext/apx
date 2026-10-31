// The owner's edit mode on a page: what element lies under a point, and changes shown only in their view until the
// page reloads. Plain DOM and CSS commands: no script runs in the page, so it cannot fake a pick or see the edits.

import type { ElementEdit, PickedElement } from "./browser.ts";
import type { CdpSend } from "./cdp.ts";
import { ApxError } from "./client.ts";

type DescribedNode = {
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

  /** The element under a point given as fractions of the visible page (0–1), or null over nothing editable. */
  async inspect(fx: number, fy: number): Promise<PickedElement | null> {
    const m = await this.#send<{ cssVisualViewport?: { clientWidth: number; clientHeight: number } }>(
      "Page.getLayoutMetrics",
    );
    const vw = m.cssVisualViewport?.clientWidth ?? 0;
    const vh = m.cssVisualViewport?.clientHeight ?? 0;
    if (!vw || !vh) throw new ApxError({ code: "unavailable", message: "the page has no size yet" });
    await this.#send("DOM.getDocument", { depth: 0 });
    const hit = await this.#send<{ backendNodeId: number }>("DOM.getNodeForLocation", {
      x: Math.round(fx * vw),
      y: Math.round(fy * vh),
      ignorePointerEventsNone: true,
    }).catch(() => undefined);
    if (!hit) return null;
    const { node } = await this.#send<{ node: DescribedNode }>("DOM.describeNode", {
      backendNodeId: hit.backendNodeId,
      depth: 1,
    });
    if (node.nodeType !== 1) return null;
    const tag = (node.localName ?? node.nodeName).toLowerCase();
    if (SKIP.test(tag)) return null;
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
    const box = await this.#send<{ model: { border: number[] } }>("DOM.getBoxModel", {
      backendNodeId: node.backendNodeId,
    }).catch(() => undefined);
    const q = box?.model.border ?? [];
    const xs = [q[0], q[2], q[4], q[6]].filter((v): v is number => v !== undefined);
    const ys = [q[1], q[3], q[5], q[7]].filter((v): v is number => v !== undefined);
    const style = await this.#computed(node.backendNodeId);
    return {
      node: node.backendNodeId,
      tag,
      role: role && role !== "generic" && role !== "none" ? role : "",
      name: sensitive ? "" : name.slice(0, NAME_MAX),
      selector: selectorOf(tag, attrs),
      text: sensitive || shown === undefined ? null : shown.trim().slice(0, TEXT_MAX),
      sensitive,
      box: xs.length
        ? {
            x: Math.max(0, Math.min(...xs) / vw),
            y: Math.max(0, Math.min(...ys) / vh),
            width: (Math.max(...xs) - Math.min(...xs)) / vw,
            height: (Math.max(...ys) - Math.min(...ys)) / vh,
          }
        : null,
      style,
    };
  }

  async #computed(backendNodeId: number): Promise<PickedElement["style"]> {
    try {
      await this.#send("CSS.enable");
      const { nodeIds } = await this.#send<{ nodeIds: number[] }>("DOM.pushNodesByBackendIdsToFrontend", {
        backendNodeIds: [backendNodeId],
      });
      const nodeId = nodeIds[0];
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
