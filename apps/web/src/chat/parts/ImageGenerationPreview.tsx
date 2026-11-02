import { Button, Icons } from "@apx/ui";
import { type CSSProperties, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/index.ts";
import { MediaGroup } from "../../lazy.ts";
import type { MediaBlock } from "./mediaGroups.ts";
import "./ImageGenerationPreview.css";

const DELAYS = [
  0.85, 0.55, 0.4, 0.55, 0.85, 0.55, 0.3, 0.16, 0.3, 0.55, 0.4, 0.16, 0, 0.08, 0.4, 0.55, 0.3, 0.08, 0.16, 0.55, 0.85,
  0.55, 0.4, 0.55, 0.85,
];

export function ImageGenerationPreview({ block }: { block?: Exclude<MediaBlock, { kind: "part" }> | undefined }) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const [transition] = useState(!block);
  const [ready, setReady] = useState(!!block);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loadFailed = useCallback(() => setFailed(true), []);
  const [size, setSize] = useState({ width: 184, height: 184 });
  const [available, setAvailable] = useState(420);
  const [ratio, setRatio] = useState<number>();
  const width = Math.min(available, 420, ratio ? 420 * ratio : 420);

  useEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(entry.contentRect.width);
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = result.current;
    if (!element || !ready) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.height > 0)
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);

  const loaded = () => {
    const images = result.current?.querySelectorAll("img");
    if (!images?.length || images.length !== block?.parts.length || [...images].some((img) => !img.complete)) return;
    const first = images[0];
    setRatio(
      images.length === 1 && first?.naturalWidth && first.naturalHeight
        ? first.naturalWidth / first.naturalHeight
        : undefined,
    );
    setReady(true);
  };

  return (
    <div
      ref={root}
      className={`image-generation-preview${ready ? " is-ready" : ""}${failed ? " is-failed" : ""}`}
      role="status"
      aria-live={ready && !failed ? "off" : "polite"}
      aria-label={ready || failed ? undefined : t("media.generating")}
      style={{ width: size.width, height: size.height, "--result-width": `${width}px` } as CSSProperties}
    >
      <div className="image-generation-preview__tiles" aria-hidden="true">
        <Icons.Image className="image-generation-preview__symbol" strokeWidth={1.4} aria-hidden="true" />
        {DELAYS.map((delay, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional tiles
          <i key={index} style={{ "--tile-delay": `${delay}s` } as CSSProperties} />
        ))}
      </div>
      <div
        ref={result}
        className="image-generation-preview__result"
        inert={!ready}
        onLoadCapture={loaded}
        onErrorCapture={loadFailed}
      >
        {block && !failed && (
          <Suspense fallback={null}>
            <MediaGroup key={attempt} block={block} eager={transition || attempt > 0} onImageError={loadFailed} />
          </Suspense>
        )}
      </div>
      {failed && (
        <div className="image-generation-preview__error">
          <span>{t("media.imageLoadFailed")}</span>
          <Button
            size="sm"
            onClick={() => {
              setReady(false);
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
