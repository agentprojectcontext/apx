import type { Part } from "@apx/protocol";
import { type InlineNode, isMediaId, parseInlineBlock } from "@apx/protocol/inline-ui";
import { Badge, Button, Dialog, IconButton, Icons, Skeleton } from "@apx/ui";
import { type ReactNode, Suspense, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { MediaGroup } from "../lazy.ts";
import { useMediaUrl } from "./parts/useMediaUrl.ts";
import "./InlineView.css";

type ImagePart = Extract<Part, { type: "image" }>;
const toPart = (src: string, alt: string): ImagePart =>
  isMediaId(src) ? { type: "image", media_id: src, mime: "image/jpeg", alt } : { type: "image", url: src, alt };

function Picture({ node }: { node: Extract<InlineNode, { kind: "image" }> }) {
  const own = isMediaId(node.src);
  const held = useMediaUrl(own ? node.src : undefined);
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const src = own ? held : node.src;
  if (broken) return null;
  const cls = `apx-inline__image apx-inline__image--${node.shape}`;
  const img = src && (
    <img src={src} alt={node.alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  );
  if (!node.gallery) return <div className={cls}>{img}</div>;
  const parts = node.gallery.map((g) => toPart(g, node.alt));
  return (
    <>
      <button type="button" className={`${cls} apx-inline__open`} onClick={() => setOpen(true)}>
        {img}
        <span className="apx-inline__more">+{node.gallery.length - 1}</span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <MediaGroup
            block={{ kind: "images", parts, key: node.src }}
            view={{ start: 0, onClose: () => setOpen(false) }}
          />
        </Suspense>
      )}
    </>
  );
}

/** What shows while the agent is still writing the block: two cards taking shape, never its code. */
function Loading() {
  const t = useT();
  return (
    <section className="apx-inline" aria-busy="true" aria-label={t("chat.inline.loading")}>
      <div className="apx-inline__head">
        <div className="apx-inline__heading apx-inline__loading">{t("chat.inline.loading")}</div>
      </div>
      <div className="apx-inline__track">
        {[0, 1, 2].map((i) => (
          <div key={i} className="apx-inline__card">
            <Skeleton shape="block" className="apx-inline__ghost" />
            <Skeleton width="40%" />
            <Skeleton width="75%" height={16} />
            <Skeleton />
            <Skeleton width="85%" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Cards side by side to slide through, like a message's videos: arrows and a count when there is more than one. */
function Carousel({ children }: { children: InlineNode[] }) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [end, setEnd] = useState(false);
  const step = () => {
    const card = track.current?.firstElementChild as HTMLElement | null;
    return card ? card.offsetWidth + 12 : 0;
  };
  // Where the arrows are taking it: quick presses add up instead of restarting from wherever the scroll is.
  const target = useRef<number | undefined>(undefined);
  const go = (by: number) => {
    const to = Math.max(0, Math.min(children.length - 1, (target.current ?? index) + by));
    target.current = to;
    setIndex(to);
    track.current?.scrollTo({ left: to * step(), behavior: "smooth" });
  };
  const many = children.length > 1;
  return (
    <div className="apx-inline__carousel">
      <div
        ref={track}
        className="apx-inline__track"
        onScroll={(e) => {
          const el = e.currentTarget;
          const width = step();
          const last = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
          setEnd(last);
          if (!width) return;
          const at = Math.min(children.length - 1, Math.round(el.scrollLeft / width));
          // The last cards may all be in view before the scroll reaches the target's own place.
          if (target.current !== undefined && at !== target.current && !last) return;
          target.current = undefined;
          setIndex(at);
        }}
      >
        {children.map(draw)}
      </div>
      {many && (
        <div className="apx-inline__bar">
          <IconButton
            size="sm"
            label={t("media.previous")}
            icon={<Icons.ChevronLeft size={14} />}
            disabled={index <= 0}
            onClick={() => go(-1)}
          />
          <span className="apx-inline__count">
            {end ? children.length : index + 1} / {children.length}
          </span>
          <IconButton
            size="sm"
            label={t("media.next")}
            icon={<Icons.ChevronRight size={14} />}
            disabled={end || index >= children.length - 1}
            onClick={() => go(1)}
          />
        </div>
      )}
    </div>
  );
}

function Details({ node }: { node: Extract<InlineNode, { kind: "details" }> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = node.label ?? t("chat.inline.details");
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={node.title ?? label} size="md">
        <div className="apx-inline apx-inline__dialog">{node.children.map(draw)}</div>
      </Dialog>
    </>
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
    case "highlight":
      return (
        <div key={i} className="apx-inline__highlight">
          {node.label && <span>{node.label}</span>}
          <strong>{node.value}</strong>
        </div>
      );
    case "divider":
      return <hr key={i} className="apx-inline__divider" />;
    case "link":
      return (
        <a key={i} className="apx-inline__action" href={node.url} target="_blank" rel="noopener noreferrer">
          {node.label}
          <Icons.ExternalLink size={13} />
        </a>
      );
    case "grid":
      return <Carousel key={i}>{node.children}</Carousel>;
    default:
      return (
        <div key={i} className={`apx-inline__${node.kind}`}>
          {node.children.map(draw)}
        </div>
      );
  }
}

/** An ```apx-cards or ```a2ui block as cards; its fallback text when it asks for more, its code when unreadable. */
export function InlineView({
  lang,
  code,
  pre,
  writing = false,
}: {
  lang: string;
  code: string;
  pre: ReactNode;
  writing?: boolean;
}) {
  const t = useT();
  if (writing) return <Loading />;
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
