// The views a ```apx-cards block can take besides a list of results (`view`): choose one option with a price, compare
// side by side, places on a map, book a day and time, a confirmation, and a plan by days. Each becomes one card of
// APX pieces. A button either opens an https page or writes a message to the chat as the owner: nothing a card does
// pays, books or sends anywhere else, the agent confirms in the chat first.
import { https, list, optional, picture, record, text } from "./inline-check.ts";
import type { InlineNode } from "./inline-ui.ts";

export type Tone = "brand" | "info" | "success" | "warning" | "neutral";
export type InlineBadge = { label: string; tone: Tone };
/** What the main button says and writes; `{option}`, `{quantity}`, `{price}`, `{day}`, `{time}`, `{people}` filled in. */
export type InlineSubmit = { label: string; ask?: string };
export type ChoiceOption = {
  id: string;
  title: string;
  badge?: InlineBadge;
  description?: string;
  rating?: string;
  price?: string;
  was?: string;
  image?: string;
};
export type CompareColumn = { title: string; subtitle?: string; badge?: InlineBadge };
export type CompareRow = { label: string; values: string[]; best: number[] };
export type Place = {
  id: string;
  title: string;
  meta?: string;
  rating?: string;
  status?: InlineBadge;
  lat: number;
  lng: number;
  url?: string;
};
export type Slot = { label: string; sub?: string; off: boolean };
export type AgendaDay = { label: string; items: { time?: string; title: string; meta?: string; done: boolean }[] };

/** The pieces only these views use; part of InlineNode. */
export type ViewNode =
  | { kind: "head"; title: string; subtitle?: string; note?: string }
  /** A button that writes `text` to the chat as the owner. */
  | { kind: "ask"; label: string; text: string }
  | { kind: "choice"; options: ChoiceOption[]; quantity?: number; submit: InlineSubmit }
  | { kind: "compare"; columns: CompareColumn[]; rows: CompareRow[]; picked?: number; submit?: InlineSubmit }
  | { kind: "places"; places: Place[]; origin?: { lat: number; lng: number } }
  | {
      kind: "booking";
      what: string;
      days: Slot[];
      times: Slot[];
      people?: { min: number; max: number; value: number };
      note?: string;
      submit: InlineSubmit;
    }
  | { kind: "status"; label: string; tone: Tone; when?: string }
  | { kind: "code"; label: string; value: string }
  | { kind: "steps"; done: number; total: number }
  | { kind: "agenda"; days: AgendaDay[] }
  | { kind: "rating"; value: string };

export const VIEWS = ["cards", "choice", "compare", "places", "booking", "receipt", "agenda"] as const;

const TONES: ReadonlySet<string> = new Set(["brand", "info", "success", "warning", "neutral"]);
const fail = <T>(v: T | false | undefined): v is false => v === false;

function badge(v: unknown): InlineBadge | undefined | false {
  if (v === undefined) return undefined;
  if (text(v, 30)) return { label: v, tone: "neutral" };
  if (!record(v) || !text(v.label, 30)) return false;
  const tone = v.tone ?? "neutral";
  return typeof tone === "string" && TONES.has(tone) ? { label: v.label, tone: tone as Tone } : false;
}

function submit(v: unknown): InlineSubmit | undefined | false {
  if (v === undefined) return undefined;
  if (text(v, 40)) return { label: v };
  if (!record(v) || !text(v.label, 40)) return false;
  const ask = optional(v.ask, 300);
  return ask === false ? false : { label: v.label, ...(ask ? { ask } : {}) };
}

/** A view's own buttons: up to three, each opening an https page or writing to the chat. */
export function buttons(v: unknown): InlineNode[] | false {
  if (v === undefined) return [];
  return list(v, 0, 3, (b) => {
    if (!record(b) || !text(b.label, 40)) return false;
    if (https(b.url) && b.ask === undefined) return { kind: "link", label: b.label, url: b.url } as const;
    if (text(b.ask, 300) && b.url === undefined) return { kind: "ask", label: b.label, text: b.ask } as const;
    return false;
  });
}

function head(value: Record<string, unknown>): InlineNode[] | false {
  const title = optional(value.title, 120);
  const subtitle = optional(value.subtitle, 200);
  const note = optional(value.note, 40);
  if (fail(title) || fail(subtitle) || fail(note)) return false;
  if (!title) return [];
  return [{ kind: "head", title, ...(subtitle ? { subtitle } : {}), ...(note ? { note } : {}) }];
}

function choice(value: Record<string, unknown>): InlineNode | false {
  const options = list(value.options, 2, 8, (o) => {
    if (!record(o) || !text(o.id, 40) || !text(o.title, 80)) return false;
    const read = {
      badge: badge(o.badge),
      description: optional(o.description, 160),
      rating: optional(o.rating, 40),
      price: optional(o.price, 30),
      was: optional(o.was, 30),
    };
    if (Object.values(read).some(fail) || (o.image !== undefined && !picture(o.image))) return false;
    const out: ChoiceOption = { id: o.id, title: o.title };
    for (const [k, v] of Object.entries(read)) if (v) Object.assign(out, { [k]: v });
    if (o.image !== undefined) out.image = o.image as string;
    return out;
  });
  const go = submit(value.submit);
  const most = value.quantity;
  if (options === false || !go) return false;
  if (most !== undefined && !(Number.isInteger(most) && (most as number) >= 1 && (most as number) <= 20)) return false;
  return { kind: "choice", options, submit: go, ...(most && most !== 1 ? { quantity: most as number } : {}) };
}

function compare(value: Record<string, unknown>): InlineNode | false {
  const columns = list(value.columns, 2, 4, (c) => {
    if (!record(c) || !text(c.title, 60)) return false;
    const subtitle = optional(c.subtitle, 60);
    const tag = badge(c.badge);
    if (fail(subtitle) || fail(tag)) return false;
    return { title: c.title, ...(subtitle ? { subtitle } : {}), ...(tag ? { badge: tag } : {}) };
  });
  if (columns === false) return false;
  const rows = list(value.rows, 1, 12, (r) => {
    if (!record(r) || !text(r.label, 60)) return false;
    const values = list(r.values, columns.length, columns.length, (cell) => (text(cell, 80) ? cell : false));
    const best = r.best === undefined ? [] : list(r.best, 0, columns.length, (i) => i);
    if (values === false || best === false) return false;
    if (!best.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < columns.length)) return false;
    return { label: r.label, values, best: best as number[] };
  });
  const picked = value.recommended;
  const go = submit(value.submit);
  if (rows === false || fail(go)) return false;
  if (
    picked !== undefined &&
    !(Number.isInteger(picked) && (picked as number) >= 0 && (picked as number) < columns.length)
  )
    return false;
  return {
    kind: "compare",
    columns,
    rows,
    ...(picked !== undefined ? { picked: picked as number } : {}),
    ...(go ? { submit: go } : {}),
  };
}

const coord = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;

function places(value: Record<string, unknown>): InlineNode | false {
  const all = list(value.places, 1, 8, (p) => {
    if (!record(p) || !text(p.id, 40) || !text(p.title, 80) || !coord(p.lat, 90) || !coord(p.lng, 180)) return false;
    const meta = optional(p.meta, 120);
    const rating = optional(p.rating, 30);
    const status = badge(p.status);
    if (fail(meta) || fail(rating) || fail(status) || (p.url !== undefined && !https(p.url))) return false;
    const out: Place = { id: p.id, title: p.title, lat: p.lat, lng: p.lng };
    if (meta) out.meta = meta;
    if (rating) out.rating = rating;
    if (status) out.status = status;
    if (p.url !== undefined) out.url = p.url as string;
    return out;
  });
  const o = value.origin;
  if (all === false) return false;
  if (o !== undefined && !(record(o) && coord(o.lat, 90) && coord(o.lng, 180))) return false;
  return { kind: "places", places: all, ...(o ? { origin: { lat: o.lat as number, lng: o.lng as number } } : {}) };
}

function slot(v: unknown): Slot | false {
  if (text(v, 20)) return { label: v, off: false };
  if (!record(v) || !text(v.label, 20)) return false;
  const sub = optional(v.sub, 20);
  return fail(sub) ? false : { label: v.label, off: v.off === true, ...(sub ? { sub } : {}) };
}

function booking(value: Record<string, unknown>): InlineNode[] | false {
  const place = value.place;
  if (!record(place) || !text(place.title, 80)) return false;
  const eyebrow = optional(place.eyebrow, 80);
  const rating = optional(place.rating, 30);
  const meta = optional(place.meta, 80);
  const days = list(value.days, 1, 14, slot);
  const times = list(value.times, 1, 24, slot);
  const note = optional(value.note, 160);
  const go = submit(value.submit);
  const p = value.people;
  if ([eyebrow, rating, meta, days, times, note].some(fail) || !go || days === false || times === false) return false;
  if (place.image !== undefined && !picture(place.image)) return false;
  let people: { min: number; max: number; value: number } | undefined;
  if (p !== undefined) {
    if (!record(p)) return false;
    const min = p.min ?? 1;
    const max = p.max ?? 10;
    const at = p.value ?? min;
    const whole = [min, max, at].every((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 50);
    if (!whole || (min as number) > (at as number) || (at as number) > (max as number)) return false;
    people = { min: min as number, max: max as number, value: at as number };
  }
  const top: InlineNode[] = [];
  if (eyebrow) top.push({ kind: "text", text: eyebrow, style: "eyebrow" });
  top.push({ kind: "text", text: place.title, style: "title" });
  if (rating) top.push({ kind: "rating", value: rating });
  if (meta) top.push({ kind: "text", text: meta, style: "caption" });
  const header: InlineNode = place.image
    ? {
        kind: "row",
        children: [
          { kind: "image", src: place.image as string, shape: "thumb", alt: place.title },
          { kind: "column", children: top },
        ],
      }
    : { kind: "column", children: top };
  return [
    header,
    {
      kind: "booking",
      what: place.title,
      days,
      times,
      submit: go,
      ...(people ? { people } : {}),
      ...(note ? { note: note as string } : {}),
    },
  ];
}

function receipt(value: Record<string, unknown>): InlineNode[] | false {
  const s = value.status;
  const when = optional(value.when, 40);
  const heading = optional(value.title, 160);
  if (!record(s) || fail(when) || fail(heading)) return false;
  const status = badge({ label: s.label, tone: s.tone ?? "success" });
  if (!status) return false;
  const rows =
    value.fields === undefined
      ? []
      : list(value.fields, 0, 10, (r) =>
          record(r) && text(r.label, 60) && text(r.value, 200) ? { label: r.label, value: r.value } : false,
        );
  const code = value.code;
  const steps = value.steps;
  if (rows === false) return false;
  if (code !== undefined && !(record(code) && text(code.label, 40) && text(code.value, 60))) return false;
  const okSteps =
    steps === undefined ||
    (record(steps) &&
      Number.isInteger(steps.done) &&
      Number.isInteger(steps.total) &&
      (steps.total as number) >= 1 &&
      (steps.total as number) <= 8 &&
      (steps.done as number) >= 0 &&
      (steps.done as number) <= (steps.total as number));
  if (!okSteps) return false;
  const out: InlineNode[] = [{ kind: "status", label: status.label, tone: status.tone, ...(when ? { when } : {}) }];
  if (heading) out.push({ kind: "text", text: heading, style: "title" });
  if (rows.length) out.push({ kind: "fields", rows });
  if (record(code)) out.push({ kind: "code", label: code.label as string, value: code.value as string });
  if (record(steps)) out.push({ kind: "steps", done: steps.done as number, total: steps.total as number });
  return out;
}

function agenda(value: Record<string, unknown>): InlineNode | false {
  const days = list(value.days, 1, 7, (d) => {
    if (!record(d) || !text(d.label, 30)) return false;
    const items = list(d.items, 1, 12, (i) => {
      if (!record(i) || !text(i.title, 80)) return false;
      const time = optional(i.time, 12);
      const meta = optional(i.meta, 120);
      if (fail(time) || fail(meta)) return false;
      return { title: i.title, done: i.done === true, ...(time ? { time } : {}), ...(meta ? { meta } : {}) };
    });
    return items === false ? false : { label: d.label, items };
  });
  return days === false ? false : { kind: "agenda", days };
}

/** A view other than `cards` as one card: its head, the view, its buttons. Undefined when it is not well formed. */
export function viewCard(view: string, value: Record<string, unknown>): InlineNode | undefined {
  const top = head(value);
  const foot = buttons(value.buttons);
  if (top === false || foot === false) return undefined;
  const body =
    view === "choice"
      ? choice(value)
      : view === "compare"
        ? compare(value)
        : view === "places"
          ? places(value)
          : view === "booking"
            ? booking(value)
            : view === "receipt"
              ? receipt(value)
              : view === "agenda"
                ? agenda(value)
                : false;
  if (body === false) return undefined;
  // A confirmation's own heading leads it; its block title is not repeated above.
  const lead = view === "receipt" ? [] : top;
  const children = [...lead, ...(Array.isArray(body) ? body : [body])];
  if (foot.length) children.push({ kind: "actions", children: foot });
  return { kind: "card", children };
}
