// Cards an agent shows inside its answer, as a fenced block. Two ways in, one tree out: ```apx-cards for a list of
// results (movies, stays, flights…) and ```a2ui for a composition of A2UI's basic catalog. Both become the same
// bounded tree of APX pieces, drawn the same way by the panel and the phone. Shared by both.
// Nothing in a block can run code: pictures are media ids or https addresses, and a card's one action opens an https page.

/** A piece of a card. Text styles follow APX Kit: eyebrow, title, body and caption. */
export type InlineNode =
  | { kind: "card"; children: InlineNode[] }
  | { kind: "column"; children: InlineNode[] }
  | { kind: "row"; children: InlineNode[] }
  | { kind: "grid"; children: InlineNode[] }
  | { kind: "text"; text: string; style: "eyebrow" | "title" | "body" | "caption" }
  /** `gallery`: every picture of the result, this one first, when it has more than one to open and step through. */
  | { kind: "image"; src: string; shape: "banner" | "thumb"; alt: string; gallery?: string[] }
  | { kind: "link"; label: string; url: string }
  | { kind: "badges"; items: string[] }
  | { kind: "fields"; rows: { label: string; value: string }[] }
  | { kind: "details"; label?: string; children: InlineNode[] }
  | { kind: "divider" };

export type InlineView = { title?: string; example: boolean; root: InlineNode };

/** A view to draw, or only the block's own text when the client cannot draw what it asks for. */
export type InlineBlock = { kind: "view"; view: InlineView; fallback: string } | { kind: "fallback"; text: string };

export const CARDS_LANG = "apx-cards";
export const A2UI_LANG = "a2ui";
export const INLINE_LANGS: ReadonlySet<string> = new Set([CARDS_LANG, A2UI_LANG]);

const MAX_CODE = 32_000;
const MAX_ITEMS = 12;
const MAX_NODES = 60;
const MAX_DEPTH = 10;
const MEDIA = /^med_[A-Za-z0-9_-]{1,80}$/;
const MAX_URL = 2000;
const ID = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
export const A2UI_BASIC_CATALOG = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const optional = (v: unknown, max: number): string | undefined | false =>
  v === undefined ? undefined : text(v, max) ? v : false;

/** A picture or page address a card may use: https only, so a block never reaches a local or plain-text address. */
function https(v: unknown): v is string {
  if (typeof v !== "string" || v.length > MAX_URL || /\s/.test(v)) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** Whether an image's `src` is a picture APX holds (loaded through the core) rather than a web address. */
export const isMediaId = (src: string): boolean => MEDIA.test(src);
const picture = (v: unknown): v is string => typeof v === "string" && (MEDIA.test(v) || https(v));

const MAX_PHOTOS = 8;

function photos(first: unknown, more: unknown): string[] | false {
  if (first !== undefined && !picture(first)) return false;
  if (more !== undefined && (!Array.isArray(more) || more.length > MAX_PHOTOS || !more.every(picture))) return false;
  return [...new Set([...(first === undefined ? [] : [first]), ...((more as string[] | undefined) ?? [])])].slice(
    0,
    MAX_PHOTOS,
  );
}

function action(v: unknown): InlineNode | undefined | false {
  if (v === undefined) return undefined;
  if (!record(v) || !text(v.label, 40) || !https(v.url)) return false;
  return { kind: "link", label: v.label, url: v.url };
}

function json(code: string): unknown {
  if (code.length > MAX_CODE) return undefined;
  try {
    return JSON.parse(code);
  } catch {
    return undefined;
  }
}

/**
 * The block as cards, its fallback text when it is well formed but asks for something APX does not draw, or undefined
 * when it is not a block APX reads (the client shows the code as it is).
 */
export function parseInlineBlock(lang: string, code: string): InlineBlock | undefined {
  if (!INLINE_LANGS.has(lang)) return undefined;
  const value = json(code);
  if (!record(value) || !text(value.fallback, 4000)) return undefined;
  const fallback = value.fallback;
  const root = lang === CARDS_LANG ? cards(value) : a2ui(value);
  if (!root) return { kind: "fallback", text: fallback };
  const title = optional(value.title, 120);
  if (title === false) return { kind: "fallback", text: fallback };
  return {
    kind: "view",
    view: { ...(title ? { title } : {}), example: value.example === true, root },
    fallback,
  };
}

function badges(v: unknown): string[] | undefined | false {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 8 || !v.every((tag) => text(tag, 60))) return false;
  return [...new Set(v as string[])];
}

function fields(v: unknown): { label: string; value: string }[] | undefined | false {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 8) return false;
  const rows: { label: string; value: string }[] = [];
  for (const row of v) {
    if (!record(row) || !text(row.label, 60) || !text(row.value, 160)) return false;
    rows.push({ label: row.label, value: row.value });
  }
  return rows;
}

/** ```apx-cards: `{ title?, example?, layout?: "grid" | "list", items: [...], fallback }`. */
function cards(value: Record<string, unknown>): InlineNode | undefined {
  const layout = value.layout ?? "grid";
  if ((layout !== "grid" && layout !== "list") || !Array.isArray(value.items)) return undefined;
  if (value.items.length < 1 || value.items.length > MAX_ITEMS) return undefined;
  const out: InlineNode[] = [];
  for (const item of value.items) {
    if (!record(item) || !text(item.title, 200)) return undefined;
    const eyebrow = optional(item.eyebrow, 80);
    const description = optional(item.description, 600);
    const details = optional(item.details, 1500);
    const pictures = photos(item.image, item.images);
    const tags = badges(item.badges);
    const rows = fields(item.fields);
    const link = action(item.action);
    if (eyebrow === false || description === false || details === false || tags === false || rows === false)
      return undefined;
    if (link === false || pictures === false) return undefined;
    const body: InlineNode[] = [];
    if (eyebrow) body.push({ kind: "text", text: eyebrow, style: "eyebrow" });
    body.push({ kind: "text", text: item.title, style: "title" });
    if (description) body.push({ kind: "text", text: description, style: "body" });
    if (tags?.length) body.push({ kind: "badges", items: tags });
    if (rows?.length) body.push({ kind: "fields", rows });
    if (details) body.push({ kind: "details", children: [{ kind: "text", text: details, style: "body" }] });
    if (link) body.push(link);
    const [image] = pictures;
    const shown = image
      ? ({ kind: "image", src: image, alt: item.title, ...(pictures.length > 1 ? { gallery: pictures } : {}) } as const)
      : undefined;
    out.push(
      !shown
        ? { kind: "card", children: body }
        : layout === "list"
          ? {
              kind: "card",
              children: [
                {
                  kind: "row",
                  children: [
                    { ...shown, shape: "thumb" },
                    { kind: "column", children: body },
                  ],
                },
              ],
            }
          : { kind: "card", children: [{ ...shown, shape: "banner" }, ...body] },
    );
  }
  return { kind: layout === "list" ? "column" : "grid", children: out };
}

type A2Component = Record<string, unknown> & { id: string; component: string };

/**
 * ```a2ui: `{ messages: [createSurface, updateComponents], fallback }` in A2UI v1.0 with the basic catalog. Literal
 * values only (no data bindings, functions or actions): Text, Image (a media id or https address), Row, Column, List, Card, Divider and
 * Modal, drawn as an expandable section. Icon is left out. Anything else draws the fallback.
 */
function a2ui(value: Record<string, unknown>): InlineNode | undefined {
  const messages = value.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 4) return undefined;
  let surface: string | undefined;
  const components = new Map<string, A2Component>();
  for (const message of messages) {
    if (!record(message) || message.version !== "1.0") return undefined;
    const create = message.createSurface;
    const update = message.updateComponents;
    let list: unknown;
    if (record(create)) {
      if (surface || typeof create.surfaceId !== "string" || create.catalogId !== A2UI_BASIC_CATALOG) return undefined;
      surface = create.surfaceId;
      list = create.components;
    } else if (record(update)) {
      if (!surface || update.surfaceId !== surface) return undefined;
      list = update.components;
    } else return undefined;
    if (list === undefined) continue;
    if (!Array.isArray(list)) return undefined;
    for (const c of list) {
      if (!record(c) || typeof c.id !== "string" || !ID.test(c.id) || typeof c.component !== "string") return undefined;
      components.set(c.id, c as A2Component);
    }
  }
  if (!surface || components.size < 1 || components.size > MAX_NODES) return undefined;
  const seen = new Set<string>();
  const visit = (id: unknown, depth: number): InlineNode | null | undefined => {
    if (typeof id !== "string" || depth > MAX_DEPTH || seen.has(id)) return undefined;
    const c = components.get(id);
    if (!c) return undefined;
    seen.add(id);
    const many = (ids: unknown): InlineNode[] | undefined => {
      if (!Array.isArray(ids) || ids.length > 20) return undefined;
      const nodes: InlineNode[] = [];
      for (const child of ids) {
        const node = visit(child, depth + 1);
        if (node === undefined) return undefined;
        if (node) nodes.push(node);
      }
      return nodes;
    };
    switch (c.component) {
      case "Text": {
        if (!text(c.text, 1200)) return undefined;
        const strong = typeof c.weight === "string" && /^(bold|semibold|[6-9]00)$/.test(c.weight);
        const style = c.variant === "caption" ? "caption" : strong ? "title" : "body";
        return { kind: "text", text: c.text, style };
      }
      case "Image": {
        if (!picture(c.url)) return undefined;
        const small = c.variant === "icon" || c.variant === "avatar" || c.variant === "smallFeature";
        const alt = typeof c.description === "string" ? c.description.slice(0, 200) : "";
        return { kind: "image", src: c.url, shape: small ? "thumb" : "banner", alt };
      }
      case "Icon":
        return null;
      case "Divider":
        return { kind: "divider" };
      case "Card": {
        const child = visit(c.child, depth + 1);
        return child === undefined ? undefined : { kind: "card", children: child ? [child] : [] };
      }
      case "Row":
      case "Column": {
        const children = many(c.children);
        return children && { kind: c.component === "Row" ? "row" : "column", children };
      }
      case "List": {
        const children = many(c.children);
        return children && { kind: c.direction === "horizontal" ? "grid" : "column", children };
      }
      case "Modal": {
        const trigger = components.get(typeof c.trigger === "string" ? c.trigger : "");
        const label = trigger?.component === "Text" && text(trigger.text, 80) ? trigger.text : undefined;
        if (label && trigger) seen.add(trigger.id);
        const content = visit(c.content, depth + 1);
        return content === undefined ? undefined : { kind: "details", label, children: content ? [content] : [] };
      }
      default:
        return undefined;
    }
  };
  const root = visit("root", 0);
  return root && seen.size === components.size ? root : undefined;
}
