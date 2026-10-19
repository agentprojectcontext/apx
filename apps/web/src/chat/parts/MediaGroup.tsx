// A message's pictures as one grid that opens a viewer to step through them, and its videos as one carousel. Loaded
// with the first message that has media, so it never weighs on the panel's first script.
import { ContextMenu, Dialog, IconButton, Icons, Skeleton } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../../common/format.ts";
import { mediaUrl } from "../../data/media.ts";
import { useT } from "../../i18n/index.ts";
import { useImageMenu } from "./imageMenu.tsx";
import type { ImageLike, MediaBlock, VideoPart } from "./mediaGroups.ts";
import "../../styles/media.css";

const SAFE = /^(https?:|data:image\/)/i;

/** The object URL of a media file APX holds, once loaded (its own copy: a shared hook would be a chunk of its own). */
function useMediaUrl(id: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!id) return;
    let live = true;
    mediaUrl(id).then(
      (u) => live && setUrl(u),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}

function useImageSrc(part: ImageLike): string | undefined {
  const own = useMediaUrl(part.media_id);
  if (part.media_id) return own;
  return part.type === "image" && part.url && SAFE.test(part.url) ? part.url : undefined;
}

const nameOf = (part: ImageLike) => (part.type === "file" ? part.name : part.alt || "image");

/** How many tiles each row of a picture grid holds (from five on, the last tile counts the ones left). */
export function mosaicRows(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [1];
  if (count === 2) return [2];
  if (count === 3) return [1, 2];
  if (count === 4) return [2, 2];
  return [2, 3];
}

export default function MediaGroup({ block }: { block: Exclude<MediaBlock, { kind: "part" }> }) {
  return block.kind === "images" ? <ImageGrid parts={block.parts} /> : <VideoCarousel parts={block.parts} />;
}

function ImageGrid({ parts }: { parts: ImageLike[] }) {
  const [open, setOpen] = useState<number>();
  const rows = mosaicRows(parts.length);
  const shown = rows.reduce((sum, n) => sum + n, 0);
  let next = 0;
  return (
    <>
      <div className={`mediagrid${parts.length === 1 ? " is-single" : ""}`}>
        {rows.map((count, r) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <div key={r} className="mediagrid__row" style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
            {Array.from({ length: count }, () => {
              const index = next++;
              const part = parts[index];
              if (!part) return null;
              const more = index === shown - 1 ? parts.length - shown : 0;
              return (
                <Tile
                  key={part.media_id ?? index}
                  part={part}
                  more={more}
                  single={parts.length === 1}
                  wide={count === 1 && rows.length > 1}
                  onOpen={() => setOpen(index)}
                />
              );
            })}
          </div>
        ))}
      </div>
      {open !== undefined && <Gallery parts={parts} start={open} onClose={() => setOpen(undefined)} />}
    </>
  );
}

function Tile({
  part,
  more,
  single,
  wide,
  onOpen,
}: {
  part: ImageLike;
  more: number;
  single: boolean;
  wide: boolean;
  onOpen: () => void;
}) {
  const src = useImageSrc(part);
  const items = useImageMenu(src, nameOf(part), !part.media_id, onOpen);
  const cls = `mediagrid__tile${wide ? " is-wide" : ""}`;
  if (!src) return <Skeleton className={cls} />;
  return (
    <ContextMenu items={items} render={<button type="button" className={cls} onClick={onOpen} title={nameOf(part)} />}>
      {/* A single tile needs the image's intrinsic size; lazy loading can leave its box at zero. */}
      <img src={src} alt={part.type === "image" ? part.alt : part.name} loading={single ? "eager" : "lazy"} />
      {more > 0 && <span className="mediagrid__more">+{more}</span>}
    </ContextMenu>
  );
}

/** Full size, one at a time: arrows (or the keyboard's) step through the message's pictures. */
function Gallery({ parts, start, onClose }: { parts: ImageLike[]; start: number; onClose: () => void }) {
  const t = useT();
  const [index, setIndex] = useState(start);
  const part = parts[index];
  const step = (by: number) => setIndex((i) => (i + by + parts.length) % parts.length);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    // Capture: the dialog handles its own keys before they would bubble up here.
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  if (!part) return null;
  return (
    <Dialog
      bare
      open
      onOpenChange={(o) => !o && onClose()}
      title={nameOf(part)}
      closeLabel={t("common.close")}
      className="imageviewer"
    >
      <div className="imageviewer__frame">
        <GalleryImage part={part} />
        {parts.length > 1 && (
          <div className="mediagallery__bar">
            <IconButton label={t("media.previous")} icon={<Icons.ChevronLeft size={16} />} onClick={() => step(-1)} />
            <span className="mediagallery__count">
              {index + 1} / {parts.length}
            </span>
            <IconButton label={t("media.next")} icon={<Icons.ChevronRight size={16} />} onClick={() => step(1)} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function GalleryImage({ part }: { part: ImageLike }) {
  const src = useImageSrc(part);
  const items = useImageMenu(src, nameOf(part), !part.media_id);
  if (!src) return <Skeleton />;
  return (
    <ContextMenu items={items} render={<span className="mediagallery__image" />}>
      <img src={src} alt={part.type === "image" ? part.alt : part.name} />
    </ContextMenu>
  );
}

/** One video, or several to scroll through; each loads once it comes into view, and playing one pauses the others. */
function VideoCarousel({ parts }: { parts: VideoPart[] }) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const many = parts.length > 1;
  // Where the arrows are taking it: quick presses add up instead of restarting from wherever the scroll is.
  const target = useRef<number | undefined>(undefined);
  const step = () => {
    const card = track.current?.querySelector<HTMLElement>(".mediacarousel__card");
    return card ? card.offsetWidth + 10 : 0;
  };
  const go = (by: number) => {
    const to = Math.max(0, Math.min(parts.length - 1, (target.current ?? index) + by));
    target.current = to;
    setIndex(to);
    track.current?.scrollTo({ left: to * step(), behavior: "smooth" });
  };
  return (
    <div className={`mediacarousel${many ? " is-many" : ""}`}>
      <div
        ref={track}
        className="mediacarousel__track"
        onScroll={(e) => {
          const width = step();
          if (!width) return;
          const at = Math.round(e.currentTarget.scrollLeft / width);
          if (target.current !== undefined && at !== target.current) return;
          target.current = undefined;
          setIndex(at);
        }}
        onPlayCapture={(e) => {
          for (const v of track.current?.querySelectorAll("video") ?? []) if (v !== e.target) v.pause();
        }}
      >
        {parts.map((p) => (
          <VideoCard key={p.media_id} part={p} root={track} />
        ))}
      </div>
      {many && (
        <div className="mediacarousel__bar">
          <IconButton
            size="sm"
            label={t("media.previous")}
            icon={<Icons.ChevronLeft size={14} />}
            disabled={index <= 0}
            onClick={() => go(-1)}
          />
          <span className="mediacarousel__count">
            {Math.min(index + 1, parts.length)} / {parts.length}
          </span>
          <IconButton
            size="sm"
            label={t("media.next")}
            icon={<Icons.ChevronRight size={14} />}
            disabled={index >= parts.length - 1}
            onClick={() => go(1)}
          />
        </div>
      )}
    </div>
  );
}

function VideoCard({ part, root }: { part: VideoPart; root: React.RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const card = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = card.current;
    if (!el || near) return;
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      root: root.current,
      rootMargin: "0px 50% 0px 50%",
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [near, root]);
  const src = useMediaUrl(near ? part.media_id : undefined);
  const save = async () => {
    const a = document.createElement("a");
    a.href = await mediaUrl(part.media_id);
    a.download = part.name;
    a.click();
  };
  return (
    <div ref={card} className="mediacarousel__card">
      {src ? (
        // biome-ignore lint/a11y/useMediaCaption: project videos are shared as supplied, without a separate caption track.
        <video src={src} controls preload="metadata" aria-label={part.name} />
      ) : (
        <Skeleton className="mediacarousel__poster" />
      )}
      <div className="mediacarousel__info">
        <span className="mediacarousel__name" title={part.name}>
          {part.name}
        </span>
        <span className="mediacarousel__size">{formatBytes(part.bytes)}</span>
        <IconButton
          size="sm"
          label={t("media.download")}
          icon={<Icons.Download size={13} />}
          onClick={() => void save()}
        />
      </div>
    </div>
  );
}
