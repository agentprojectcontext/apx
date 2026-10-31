// Edit mode of the browser panel: the elements the owner picked in a page, what they changed in each, and the
// request it becomes in the chat. The changes show in the page only in the owner's view (browser.preview_edits).
import type { ElementEdit, PickedElement } from "@apx/protocol";
import { hostPath } from "../common/format.ts";
import { createStore } from "../data/createStore.ts";
import type { T } from "../i18n/index.ts";

export type EditStyle = NonNullable<ElementEdit["style"]>;

/** One picked element and the owner's changes to it; absent fields are left as the page has them. */
export type EditItem = { element: PickedElement; text?: string; style: EditStyle; note: string };

export type BrowserEditState = { tab: string | undefined; items: EditItem[]; selected: number | undefined };

export const browserEdit = createStore<BrowserEditState>({ tab: undefined, items: [], selected: undefined });

export function startEditing(tab: string): void {
  browserEdit.set({ tab, items: [], selected: undefined });
}

export function stopEditing(): void {
  browserEdit.set({ tab: undefined, items: [], selected: undefined });
}

/** Selects the element, adding it to the list the first time it is picked. */
export function pick(element: PickedElement): void {
  browserEdit.set((s) =>
    s.items.some((i) => i.element.node === element.node)
      ? { selected: element.node }
      : { items: [...s.items, { element, style: {}, note: "" }], selected: element.node },
  );
}

export function changeItem(node: number, change: Partial<Omit<EditItem, "element">>): void {
  browserEdit.set((s) => ({ items: s.items.map((i) => (i.element.node === node ? { ...i, ...change } : i)) }));
}

export function removeItem(node: number): void {
  browserEdit.set((s) => ({
    items: s.items.filter((i) => i.element.node !== node),
    selected: s.selected === node ? undefined : s.selected,
  }));
}

/** Whether the owner asked for anything about this element. */
export function isChanged(item: EditItem): boolean {
  return (
    (item.text !== undefined && item.text !== item.element.text) ||
    Object.values(item.style).some((v) => v !== undefined) ||
    item.note.trim() !== ""
  );
}

/** What the page shows for the items: only text and style, the notes are for the agent. */
export function editsOf(items: readonly EditItem[]): ElementEdit[] {
  return items
    .map((i) => {
      const style = Object.fromEntries(Object.entries(i.style).filter(([, v]) => v !== undefined)) as EditStyle;
      return {
        node: i.element.node,
        ...(i.text !== undefined && i.text !== i.element.text ? { text: i.text } : {}),
        ...(Object.keys(style).length ? { style } : {}),
      };
    })
    .filter((e) => e.text !== undefined || e.style);
}

/** How the owner names an element: its accessible name or text, else its tag. Page text, cut short. */
export function elementLabel(element: PickedElement): string {
  const words = (element.name || element.text || "").replace(/\s+/g, " ").trim();
  return words.length > 60 ? `${words.slice(0, 60).trimEnd()}…` : words;
}

/**
 * The request the changes become in the chat, as quote lines the agent reads with the owner's own words after them:
 * the page, then each element (its words, its selector to find it in the code) with what should change.
 */
export function editRequest(url: string, items: readonly EditItem[], t: T): string {
  const lines = [t("bedit.request.page", { page: hostPath(url), url })];
  items.filter(isChanged).forEach((item, n) => {
    const { element, style } = item;
    const label = elementLabel(element);
    const changes: string[] = [];
    if (item.text !== undefined && item.text !== element.text)
      changes.push(t("bedit.request.text", { text: item.text }));
    if (style.color) changes.push(t("bedit.request.color", { value: style.color }));
    if (style.background) changes.push(t("bedit.request.background", { value: style.background }));
    if (style.font_size !== undefined) changes.push(t("bedit.request.size", { value: style.font_size }));
    if (style.padding !== undefined) changes.push(t("bedit.request.padding", { value: style.padding }));
    const note = item.note.trim().replace(/\s+/g, " ");
    if (note) changes.push(t("bedit.request.note", { note }));
    const name = label ? `«${label}» (\`${element.selector}\`)` : `\`${element.selector}\``;
    lines.push(`${n + 1}. ${name}: ${changes.join("; ")}`);
  });
  return lines.map((l) => `> ${l}`).join("\n");
}

/** Color for a color input: the page's computed `rgb(…)` as hex, else black. */
export function hexOf(css: string | undefined): string {
  if (css && /^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  const m = css?.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return "#000000";
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}
