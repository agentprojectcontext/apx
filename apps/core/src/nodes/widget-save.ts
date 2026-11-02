// Saving the owner's edits into a widget's own HTML. The edited element is found in the running page by DOM commands,
// then at the same place in the HTML parsed with scripts off; elements its code draws at run time are not there and are
// left for its agent. The HTML is written back by the browser's own serializer, so nothing the owner typed becomes markup.
import type { ElementEdit } from "@apx/protocol";

export type DomNode = {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue?: string;
  attributes?: string[];
  children?: DomNode[];
};

type Send = <T>(method: string, params?: object) => Promise<T>;

const tagOf = (n: DomNode) => (n.localName ?? n.nodeName).toLowerCase();
const elements = (n: DomNode) => (n.children ?? []).filter((c) => c.nodeType === 1);

function attr(n: DomNode, name: string): string | undefined {
  const raw = n.attributes ?? [];
  for (let k = 0; k + 1 < raw.length; k += 2) if (String(raw[k]).toLowerCase() === name) return String(raw[k + 1]);
  return undefined;
}

/** The element's only text node when it has no child elements, as in edit mode. */
function soleText(n: DomNode): DomNode | undefined {
  const kids = n.children ?? [];
  const texts = kids.filter((c) => c.nodeType === 3 && (c.nodeValue ?? "").trim());
  if (texts.length !== 1 || kids.some((c) => c.nodeType === 1)) return undefined;
  return texts[0];
}

function bodyOf(doc: DomNode): DomNode | undefined {
  const html = elements(doc).find((c) => tagOf(c) === "html");
  return html && elements(html).find((c) => tagOf(c) === "body");
}

/** How to find an element again: its place under <body> and what it is. */
export type Locator = { path: number[]; tag: string; id?: string; cls?: string; text?: string };

export function locate(doc: DomNode, backendNodeId: number): Locator | undefined {
  const body = bodyOf(doc);
  if (!body) return undefined;
  const walk = (n: DomNode, path: number[]): Locator | undefined => {
    for (const [i, c] of elements(n).entries()) {
      if (c.backendNodeId === backendNodeId) {
        const text = soleText(c)?.nodeValue?.trim();
        const id = attr(c, "id");
        const cls = attr(c, "class");
        return {
          path: [...path, i],
          tag: tagOf(c),
          ...(id ? { id } : {}),
          ...(cls ? { cls } : {}),
          ...(text ? { text } : {}),
        };
      }
      const found = walk(c, [...path, i]);
      if (found) return found;
    }
    return undefined;
  };
  return walk(body, []);
}

const same = (n: DomNode, l: Locator) =>
  tagOf(n) === l.tag &&
  attr(n, "id") === l.id &&
  attr(n, "class") === l.cls &&
  soleText(n)?.nodeValue?.trim() === l.text;

/** The element at the locator's place when it is the same element; else the only one like it, if just one is. */
export function resolve(doc: DomNode, l: Locator): DomNode | undefined {
  const body = bodyOf(doc);
  if (!body) return undefined;
  let at: DomNode | undefined = body;
  for (const i of l.path) at = at ? elements(at)[i] : undefined;
  if (at && same(at, l)) return at;
  const like: DomNode[] = [];
  const walk = (n: DomNode) => {
    for (const c of elements(n)) {
      if (same(c, l)) like.push(c);
      walk(c);
    }
  };
  walk(body);
  return like.length === 1 ? like[0] : undefined;
}

const PROPS = { color: "color", background: "background-color", font_size: "font-size", padding: "padding" } as const;

/** The element's `style` with the edit's declarations in place of any it had for the same properties. */
export function mergeStyle(base: string | undefined, style: NonNullable<ElementEdit["style"]>): string {
  const set = new Map<string, string>();
  if (style.color) set.set(PROPS.color, style.color);
  if (style.background) set.set(PROPS.background, style.background);
  if (style.font_size !== undefined) set.set(PROPS.font_size, `${style.font_size}px`);
  if (style.padding !== undefined) set.set(PROPS.padding, `${style.padding}px`);
  const kept = (base ?? "")
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !set.has(d.split(":")[0]?.trim().toLowerCase() ?? ""));
  return [...kept, ...[...set].map(([k, v]) => `${k}: ${v}`)].join("; ");
}

/** Applies the edits found in the source page; returns which were applied. */
export async function applyEdits(
  send: Send,
  doc: DomNode,
  edits: ReadonlyArray<{ edit: ElementEdit; at: Locator }>,
): Promise<number[]> {
  const saved: number[] = [];
  for (const { edit, at } of edits) {
    const el = resolve(doc, at);
    if (!el) continue;
    const text = edit.text !== undefined ? soleText(el) : undefined;
    if (edit.text !== undefined && !text) continue;
    if (edit.style)
      await send("DOM.setAttributeValue", {
        nodeId: el.nodeId,
        name: "style",
        value: mergeStyle(attr(el, "style"), edit.style),
      });
    if (text && edit.text !== undefined) {
      // The spaces around the words stay as the HTML had them.
      const raw = text.nodeValue ?? "";
      const lead = raw.match(/^\s*/)?.[0] ?? "";
      const trail = raw.match(/\s*$/)?.[0] ?? "";
      await send("DOM.setNodeValue", { nodeId: text.nodeId, value: `${lead}${edit.text}${trail}` });
    }
    saved.push(edit.node);
  }
  return saved;
}

/** The source written back: a whole document keeps its doctype; a fragment stays a fragment. */
export async function serialize(send: Send, doc: DomNode, source: string): Promise<string> {
  const html = elements(doc).find((c) => tagOf(c) === "html");
  if (!html) return source;
  const outer = async (n: DomNode) =>
    (await send<{ outerHTML: string }>("DOM.getOuterHTML", { nodeId: n.nodeId })).outerHTML;
  if (/<html[\s>]/i.test(source)) {
    const doctype = source.match(/^\s*<!doctype[^>]*>/i)?.[0].trim();
    return `${doctype ? `${doctype}\n` : ""}${await outer(html)}`;
  }
  const inner = async (tag: string) => {
    const n = elements(html).find((c) => tagOf(c) === tag);
    if (!n) return "";
    return (await outer(n)).replace(new RegExp(`^<${tag}[^>]*>`, "i"), "").replace(new RegExp(`</${tag}>$`, "i"), "");
  };
  return `${await inner("head")}${await inner("body")}`;
}
