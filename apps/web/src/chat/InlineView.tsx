import { type InlineNode, parseInlineBlock } from "@apx/protocol/inline-ui";
import { Badge } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../i18n/index.ts";
import { useMediaUrl } from "./parts/useMediaUrl.ts";
import "./InlineView.css";

function Picture({ node }: { node: Extract<InlineNode, { kind: "image" }> }) {
  const src = useMediaUrl(node.media);
  return (
    <div className={`apx-inline__image apx-inline__image--${node.shape}`}>
      {src && <img src={src} alt={node.alt} loading="lazy" />}
    </div>
  );
}

function Details({ node }: { node: Extract<InlineNode, { kind: "details" }> }) {
  const t = useT();
  return (
    <details className="apx-inline__details">
      <summary>{node.label ?? t("chat.inline.details")}</summary>
      <div>{node.children.map(draw)}</div>
    </details>
  );
}

// A view's pieces never reorder, so their place is their key.
function draw(node: InlineNode, i: number): ReactNode {
  switch (node.kind) {
    case "text":
      return (
        <div key={i} className={`apx-inline__${node.style}`}>
          {node.text}
        </div>
      );
    case "image":
      return <Picture key={i} node={node} />;
    case "badges":
      return (
        <div key={i} className="apx-inline__badges">
          {node.items.map((item) => (
            <Badge key={item}>{item}</Badge>
          ))}
        </div>
      );
    case "fields":
      return (
        <dl key={i} className="apx-inline__fields">
          {node.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "details":
      return <Details key={i} node={node} />;
    case "divider":
      return <hr key={i} className="apx-inline__divider" />;
    default:
      return (
        <div key={i} className={`apx-inline__${node.kind}`}>
          {node.children.map(draw)}
        </div>
      );
  }
}

/** An ```apx-cards or ```a2ui block as cards; its fallback text when it asks for more, its code when unreadable. */
export function InlineView({ lang, code, pre }: { lang: string; code: string; pre: ReactNode }) {
  const t = useT();
  const block = parseInlineBlock(lang, code);
  if (!block) return pre;
  if (block.kind === "fallback") return <p>{block.text}</p>;
  const { title, example, root } = block.view;
  return (
    <section className="apx-inline" aria-label={title}>
      {(title || example) && (
        <div className="apx-inline__head">
          {title && <div className="apx-inline__heading">{title}</div>}
          {example && <Badge>{t("chat.inline.example")}</Badge>}
        </div>
      )}
      {draw(root, 0)}
    </section>
  );
}
