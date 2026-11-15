import assert from "node:assert/strict";
import { test } from "node:test";
import { type InlineNode, parseInlineBlock } from "./inline-ui.ts";

const card = (value: Record<string, unknown>): InlineNode[] => {
  const block = parseInlineBlock("apx-cards", JSON.stringify({ fallback: "Plain text.", ...value }));
  assert.equal(block?.kind, "view", JSON.stringify(block));
  if (block?.kind !== "view" || block.view.root.kind !== "card") throw new Error("not a card");
  return block.view.root.children;
};
const falls = (value: Record<string, unknown>) =>
  assert.equal(parseInlineBlock("apx-cards", JSON.stringify({ fallback: "Plain text.", ...value }))?.kind, "fallback");

const headphones = {
  view: "choice",
  title: "Wireless headphones",
  subtitle: "Up to $120,000",
  note: "Prices at 14:20",
  quantity: 5,
  options: [
    { id: "a", title: "Mist Lite", badge: { label: "Best price", tone: "success" }, price: "$64,900", rating: "4.2" },
    { id: "b", title: "Pulse Pro", badge: "Recommended", price: "$98,500", was: "$118,000" },
  ],
  submit: { label: "Go with this one", ask: "I want {quantity} {option} ({price}). Confirm before paying." },
  buttons: [{ label: "More options", ask: "Show me more headphones" }],
};

test("choosing one option: its head, the options, the button and the quantity", () => {
  const [top, choice, foot] = card(headphones);
  assert.deepEqual(top, {
    kind: "head",
    title: "Wireless headphones",
    subtitle: "Up to $120,000",
    note: "Prices at 14:20",
  });
  assert.equal(choice?.kind, "choice");
  if (choice?.kind !== "choice") return;
  assert.equal(choice.quantity, 5);
  assert.deepEqual(choice.options[1]?.badge, { label: "Recommended", tone: "neutral" });
  assert.equal(choice.submit.ask, "I want {quantity} {option} ({price}). Confirm before paying.");
  assert.deepEqual(foot, {
    kind: "actions",
    children: [{ kind: "ask", label: "More options", text: "Show me more headphones" }],
  });
  falls({ ...headphones, options: headphones.options.slice(0, 1) });
  falls({ ...headphones, quantity: 50 });
  falls({ ...headphones, submit: undefined });
  falls({
    ...headphones,
    options: [{ ...headphones.options[0], badge: { label: "x", tone: "red" } }, headphones.options[1]],
  });
  falls({ ...headphones, buttons: [{ label: "Both", ask: "x", url: "https://example.com" }] });
});

test("comparing side by side keeps one value per column and the best of each row", () => {
  const [, table] = card({
    view: "compare",
    title: "Hosting",
    columns: [{ title: "Acme" }, { title: "Own server", badge: { label: "Recommended", tone: "brand" } }],
    rows: [
      { label: "Monthly", values: ["US$ 35", "US$ 12"], best: [1] },
      { label: "Deploy", values: ["Push", "Manual"] },
    ],
    recommended: 1,
    submit: { label: "Go with {option}" },
  });
  assert.equal(table?.kind === "compare" && table.picked, 1);
  assert.deepEqual(table?.kind === "compare" && table.rows[1], {
    label: "Deploy",
    values: ["Push", "Manual"],
    best: [],
  });
  const base = { view: "compare", columns: [{ title: "A" }, { title: "B" }] };
  falls({ ...base, rows: [{ label: "x", values: ["only one"] }] });
  falls({ ...base, rows: [{ label: "x", values: ["1", "2"], best: [2] }] });
  falls({ ...base, rows: [{ label: "x", values: ["1", "2"] }], recommended: 3 });
});

test("places need real coordinates, and their page is https", () => {
  const cafe = {
    id: "c1",
    title: "Harbour café",
    lat: -41.13,
    lng: -71.31,
    status: { label: "Open", tone: "success" },
  };
  const [, map] = card({ view: "places", title: "Cafés", places: [cafe], origin: { lat: -41.134, lng: -71.3 } });
  assert.deepEqual(map, { kind: "places", places: [cafe], origin: { lat: -41.134, lng: -71.3 } });
  falls({ view: "places", places: [{ ...cafe, lat: 95 }] });
  falls({ view: "places", places: [{ ...cafe, url: "http://example.com" }] });
});

test("booking a day and time: the place, the slots, the people and what the button writes", () => {
  const children = card({
    view: "booking",
    place: { eyebrow: "Restaurant", title: "Forest Inn", rating: "4.6", meta: "Patagonian · $$" },
    days: [
      { label: "Today", sub: "Fri 14" },
      { label: "Mon", sub: "closed", off: true },
    ],
    times: ["20:00", { label: "20:30", off: true }],
    people: { min: 1, max: 8, value: 2 },
    note: "Deposit of $10,000 per person",
    submit: { label: "Book", ask: "Book {day} at {time} for {people}. Confirm before paying." },
  });
  const booking = children.find((n) => n.kind === "booking");
  assert.deepEqual(booking?.kind === "booking" && booking.days[1], { label: "Mon", sub: "closed", off: true });
  assert.deepEqual(booking?.kind === "booking" && booking.people, { min: 1, max: 8, value: 2 });
  assert.equal(booking?.kind === "booking" && booking.what, "Forest Inn");
  const bad = { view: "booking", place: { title: "x" }, days: ["Today"], times: ["20:00"], submit: "Book" };
  falls({ ...bad, people: { min: 3, value: 2 } });
  falls({ ...bad, place: undefined });
});

test("a confirmation is the result: status, title, facts, a code and its buttons", () => {
  const children = card({
    view: "receipt",
    title: "Table for 2 · Forest Inn",
    status: { label: "Confirmed" },
    when: "1 min ago",
    fields: [{ label: "When", value: "Today, 21:00" }],
    code: { label: "Code", value: "HB-48213" },
    steps: { done: 2, total: 3 },
    buttons: [
      { label: "Add to calendar", url: "https://calendar.example.com/add" },
      { label: "Cancel booking", ask: "Cancel my booking at Forest Inn" },
    ],
  });
  assert.deepEqual(
    children.map((n) => n.kind),
    ["status", "text", "fields", "code", "steps", "actions"],
  );
  assert.deepEqual(children[0], { kind: "status", label: "Confirmed", tone: "success", when: "1 min ago" });
  falls({ view: "receipt", status: { label: "Confirmed" }, steps: { done: 4, total: 3 } });
});

test("a plan by days, and a view APX does not know falls back", () => {
  const [, plan] = card({
    view: "agenda",
    title: "Your weekend",
    days: [{ label: "Sat 15", items: [{ time: "09:00", title: "Leave", done: true }, { title: "Dinner" }] }],
  });
  assert.deepEqual(plan?.kind === "agenda" && plan.days[0]?.items[1], { title: "Dinner", done: false });
  falls({ view: "agenda", days: [] });
  falls({ view: "kanban", items: [] });
});

test("a result's own button can write to the chat instead of opening a page", () => {
  const block = parseInlineBlock(
    "apx-cards",
    JSON.stringify({
      fallback: "x",
      items: [{ id: "a", title: "Northbound", action: { label: "Pick", ask: "I pick Northbound" } }],
    }),
  );
  const first = block?.kind === "view" && "children" in block.view.root ? block.view.root.children[0] : undefined;
  const foot = first?.kind === "card" ? first.children.at(-1) : undefined;
  assert.deepEqual(foot, { kind: "actions", children: [{ kind: "ask", label: "Pick", text: "I pick Northbound" }] });
});
