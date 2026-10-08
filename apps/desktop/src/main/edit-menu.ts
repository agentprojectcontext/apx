// Electron shows no menu on a right click: text fields and selected text get the usual edit menu here. A part of
// the panel with its own menu (a thread, a link) prevents the default, so this one never opens over it.
import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";

/** The main process has no panel i18n: its few words, in the system's language. */
const TEXT = {
  en: {
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    selectAll: "Select all",
    copyLink: "Copy link",
    add: "Add to dictionary",
  },
  es: {
    cut: "Cortar",
    copy: "Copiar",
    paste: "Pegar",
    selectAll: "Seleccionar todo",
    copyLink: "Copiar enlace",
    add: "Agregar al diccionario",
  },
};

/** What the edit menu does on the page it opened over. */
export type EditActions = {
  replaceMisspelling: (word: string) => void;
  addToDictionary: (word: string) => void;
  copyText: (text: string) => void;
};

type Params = Pick<
  ContextMenuParams,
  "isEditable" | "selectionText" | "editFlags" | "misspelledWord" | "dictionarySuggestions" | "linkURL"
>;

/** The menu for a right click, empty when there is nothing to edit, copy or fix. */
export function editMenu(params: Params, locale: string, actions: EditActions): MenuItemConstructorOptions[] {
  const text = locale.startsWith("es") ? TEXT.es : TEXT.en;
  const items: MenuItemConstructorOptions[] = [];
  const word = params.misspelledWord;
  if (params.isEditable && word) {
    for (const s of params.dictionarySuggestions.slice(0, 5))
      items.push({ label: s, click: () => actions.replaceMisspelling(s) });
    items.push({ label: text.add, click: () => actions.addToDictionary(word) }, { type: "separator" });
  }
  const selected = params.selectionText.trim().length > 0;
  if (params.isEditable) {
    const f = params.editFlags;
    items.push(
      { label: text.cut, role: "cut", enabled: f.canCut && selected },
      { label: text.copy, role: "copy", enabled: f.canCopy && selected },
      { label: text.paste, role: "paste", enabled: f.canPaste },
      { type: "separator" },
      { label: text.selectAll, role: "selectAll", enabled: f.canSelectAll },
    );
  } else if (selected) items.push({ label: text.copy, role: "copy" });
  if (params.linkURL) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: text.copyLink, click: () => actions.copyText(params.linkURL) });
  }
  return items;
}
