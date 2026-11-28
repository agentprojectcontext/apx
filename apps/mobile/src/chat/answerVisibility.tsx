import { createContext, type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { type FlatList, Keyboard, type NativeScrollEvent, type NativeSyntheticEvent, type View } from "react-native";

/** Inverted transcripts move toward newer messages when their offset decreases. */
export function answerOffset(offset: number, top: number, height: number, answerTop: number, answerHeight: number) {
  const bottom = top + height;
  const answerBottom = answerTop + answerHeight;
  if (answerBottom > bottom) return Math.max(0, offset - (answerBottom - bottom));
  if (answerTop < top && answerHeight <= height) return offset + top - answerTop;
  return offset;
}

type Focus = { focus: (view: View | null) => void; blur: (view: View | null) => void; reveal: () => void };
export const AnswerVisibility = createContext<Focus | undefined>(undefined);

export function useAnswerVisibility<T>(list: RefObject<FlatList<T> | null>) {
  const viewport = useRef<View>(null);
  const focused = useRef<View | null>(null);
  const offset = useRef(0);
  const reading = useRef(false);
  const frame = useRef<number | undefined>(undefined);
  const measurement = useRef(0);
  const reveal = useCallback(() => {
    const revision = ++measurement.current;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      // Android can apply its caret scroll after the first layout frame.
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        const target = focused.current;
        if (!target || reading.current) return;
        viewport.current?.measureInWindow((_x, top, _width, height) => {
          if (revision !== measurement.current) return;
          target.measureInWindow((_ax, answerTop, _aw, answerHeight) => {
            if (
              revision !== measurement.current ||
              target !== focused.current ||
              reading.current ||
              height <= 0 ||
              answerHeight <= 0
            )
              return;
            const next = answerOffset(offset.current, top, height, answerTop, answerHeight);
            if (Math.abs(next - offset.current) < 1) return;
            list.current?.scrollToOffset({ offset: next, animated: false });
          });
        });
      });
    });
  }, [list]);
  const focus = useMemo<Focus>(
    () => ({
      focus(view) {
        focused.current = view;
        reading.current = false;
        reveal();
      },
      blur(view) {
        if (focused.current === view) focused.current = null;
      },
      reveal,
    }),
    [reveal],
  );
  useEffect(() => {
    const keyboard = Keyboard.addListener("keyboardDidShow", () => {
      reading.current = false;
      reveal();
    });
    return () => {
      keyboard.remove();
      focused.current = null;
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [reveal]);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y;
      // Native focus may scroll again after the keyboard layout.
      if (focused.current && !reading.current) reveal();
    },
    [reveal],
  );
  const onScrollBeginDrag = useCallback(() => {
    reading.current = true;
  }, []);
  return { viewport, focus, reveal, onScroll, onScrollBeginDrag };
}
