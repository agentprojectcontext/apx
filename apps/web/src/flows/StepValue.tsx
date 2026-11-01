// A step's input or output in a run's panel: an object or list as fields whose parts fold, or as its text; Copy and
// Expand like a code block in a chat.
import { CodeFrame } from "@apx/ui";
import { useMemo } from "react";
import { useT } from "../i18n/index.ts";
import { type Fields, fieldsOf, isLong, type Json } from "./step-value.ts";
import "./step-value.css";

/** Levels open at first: deeper parts start folded. */
const OPEN = 2;

export function StepValue({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone?: "failed" | "muted" | undefined;
}) {
  const t = useT();
  const fields = useMemo(() => fieldsOf(text), [text]);
  const labels = useMemo(
    () => ({
      preview: t("flow.value.fields"),
      source: t("flow.value.text"),
      showAs: t("md.showAs"),
      copy: t("msg.copy"),
      copied: t("msg.copied"),
      expand: t("md.expand"),
      close: t("common.close"),
    }),
    [t],
  );
  if (!text.trim())
    return (
      <div className="sv sv--empty">
        <span className="fd__label">{label}</span>
        <span className="fd__value is-muted">{t("flow.value.none")}</span>
      </div>
    );
  return (
    <CodeFrame
      // Fields come first whenever there are some, even after a value shown as text.
      key={fields ? "fields" : "text"}
      className={tone ? `sv is-${tone}` : "sv"}
      language={label}
      code={text}
      labels={labels}
      preview={fields ? <FieldList value={fields} depth={0} /> : undefined}
    >
      <pre className="sv__text">{text}</pre>
    </CodeFrame>
  );
}

function FieldList({ value, depth }: { value: Fields; depth: number }) {
  const list = Array.isArray(value);
  const entries: [string, Json][] = list ? value.map((v, i) => [String(i + 1), v]) : Object.entries(value);
  return (
    <ul className={depth ? "sv__list" : "sv__list sv__list--root"}>
      {entries.map(([name, v]) => (
        <Field key={name} name={name} value={v} depth={depth} index={list} />
      ))}
    </ul>
  );
}

function Field({ name, value, depth, index }: { name: string; value: Json; depth: number; index: boolean }) {
  const t = useT();
  const key = <span className={index ? "sv__key is-index" : "sv__key"}>{name}</span>;
  if (value !== null && typeof value === "object") {
    const many = Array.isArray(value) ? value.length : Object.keys(value).length;
    return (
      <li>
        <details className="sv__node" open={depth < OPEN}>
          <summary>
            {key}
            <span className="sv__count">
              {t(Array.isArray(value) ? "flow.value.items" : "flow.value.keys", { count: many })}
            </span>
          </summary>
          {many > 0 && <FieldList value={value} depth={depth + 1} />}
        </details>
      </li>
    );
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (
    <li className={typeof value === "string" && isLong(value) ? "sv__leaf is-long" : "sv__leaf"}>
      {key}
      <span className={`sv__v sv__v--${value === null ? "null" : typeof value}`}>{text === "" ? '""' : text}</span>
    </li>
  );
}
