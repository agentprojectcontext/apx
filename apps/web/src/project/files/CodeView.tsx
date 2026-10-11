// A file's text with line numbers and its language's colors, read-only or edited in place. CodeMirror is loaded only
// when a text file opens (this module is imported lazily by FilesPane).
import "../../styles/screens.css";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

/** The language a file reads as, by its name; none for plain text. */
function languageOf(path: string): Extension | undefined {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  const ext = name.includes(".") ? name.split(".").pop() : name;
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "json":
    case "jsonc":
    case "lock":
      return json();
    case "css":
    case "scss":
      return css();
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return html();
    case "md":
    case "markdown":
    case "mdx":
      return markdown();
    case "py":
      return python();
    case "php":
      return php();
    case "yml":
    case "yaml":
      return yaml();
    case "sql":
      return sql();
    case "xml":
    case "svg":
    case "plist":
      return xml();
    default:
      return undefined;
  }
}

/** The app's colors for code, from CSS variables, so light and dark follow the theme. */
const colors = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.controlKeyword], color: "var(--code-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--code-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--code-number)" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--code-comment)",
    fontStyle: "italic",
  },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--code-function)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--code-type)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--code-property)" },
  { tag: [tags.tagName, tags.heading], color: "var(--code-tag)", fontWeight: "600" },
  { tag: [tags.definition(tags.variableName)], color: "var(--code-definition)" },
  { tag: [tags.link, tags.url], color: "var(--code-string)", textDecoration: "underline" },
  { tag: [tags.emphasis], fontStyle: "italic" },
  { tag: [tags.strong], fontWeight: "700" },
  { tag: [tags.invalid], color: "var(--apx-danger)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent", color: "var(--apx-fg)" },
  ".cm-scroller": { fontFamily: "var(--apx-font-mono)", lineHeight: "1.6" },
  ".cm-content": { padding: "10px 0", caretColor: "var(--apx-fg)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--apx-fg-subtle)",
    border: "none",
    paddingLeft: "8px",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 6px", minWidth: "32px" },
  ".cm-activeLine": { backgroundColor: "var(--code-active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--apx-fg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--code-selection) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--apx-fg)" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--apx-fg-subtle)", cursor: "pointer" },
  ".cm-searchMatch": { backgroundColor: "var(--code-selection)" },
  ".cm-panels": { backgroundColor: "var(--apx-surface)", color: "var(--apx-fg)", borderColor: "var(--apx-border)" },
});

/**
 * A file's text in an editor: line numbers, folding and its language's colors; `editable` lets the owner type in it
 * (⌘S saves through `onSave`). The text given is where it starts; edits are reported through `onChange`.
 */
export function CodeView({
  path,
  text,
  editable,
  onChange,
  onSave,
}: {
  path: string;
  text: string;
  editable: boolean;
  onChange?(text: string): void;
  onSave?(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const editing = useRef(new Compartment());
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  // biome-ignore lint/correctness/useExhaustiveDependencies: built once per file; editability changes below.
  useEffect(() => {
    if (!host.current) return;
    const lang = languageOf(path);
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          foldGutter(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          bracketMatching(),
          indentOnInput(),
          highlightSelectionMatches(),
          history(),
          syntaxHighlighting(colors),
          theme,
          ...(lang ? [lang] : []),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                handlers.current.onSave?.();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          editing.current.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, [path]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editing.current.reconfigure([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
    });
    if (editable) view.current?.focus();
  }, [editable]);

  return <div ref={host} className={`codeview${editable ? " is-editing" : ""}`} />;
}
