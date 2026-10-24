import { ArrowDown } from "lucide-react";
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../cx";
import { IconButton } from "./IconButton";

/** Distance from the bottom (px) under which new content keeps the view pinned to the end. */
const STICK_PX = 120;

export interface StickyScrollHandle {
  /** The element the children are in: to find a row and scroll to it. */
  content(): HTMLDivElement | null;
  /** Stop following new content until the reader comes back to the end (after a jump to an older message). */
  release(): void;
}

export interface StickyScrollProps {
  /** A new key (another chat) jumps to the end and follows it again. */
  resetKey: string;
  /** The "back to the latest message" button's label, shown while the reader is scrolled up. */
  toBottomLabel: string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
  ref?: Ref<StickyScrollHandle>;
}

/**
 * A conversation's scroll: it stays at the end while the reader is there, new messages and late growth (images,
 * widgets) included, leaves them where they are once they scroll up, and offers a button back to the latest message.
 */
export function StickyScroll({
  resetKey,
  toBottomLabel,
  className,
  contentClassName,
  children,
  ref,
}: StickyScrollProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  useImperativeHandle(ref, () => ({
    content: () => content.current,
    release: () => {
      stick.current = false;
    },
  }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per key on purpose
  useLayoutEffect(() => {
    stick.current = true;
    setAway(false);
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [resetKey]);

  // New rows and late growth both resize the content: follow them only if the reader was at the end.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    setAway(!stick.current);
  };
  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className={cx("apx-stickyscroll", className)} ref={scroller} onScroll={onScroll}>
      <div className={contentClassName} ref={content}>
        {children}
      </div>
      {away && (
        <div className="apx-stickyscroll__tobottom">
          <IconButton
            label={toBottomLabel}
            tooltipSide="top"
            icon={<ArrowDown size={16} />}
            variant="secondary"
            shape="circle"
            onClick={toBottom}
          />
        </div>
      )}
    </div>
  );
}
