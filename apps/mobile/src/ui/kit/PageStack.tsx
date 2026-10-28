import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, useWindowDimensions } from "react-native";
import { makeStyles } from "../theme";

/** A page opened over the tabs; `leaving` while it slides away. */
export type StackPage<P> = P & { key: string; leaving?: boolean };

let next = 0;

/**
 * The pages opened over the tabs, like a chat app's: each slides in over the one under it, which stays as it was
 * (scrolled where it was), and back slides it away again.
 */
export function usePageStack<P extends object>() {
  const [pages, setPages] = useState<Array<StackPage<P>>>([]);
  const push = useCallback((page: P) => setPages((list) => [...list, { ...page, key: `p${next++}` }]), []);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  /** Back from the top page; false when there was none to leave. */
  const back = useCallback(() => {
    const open = pagesRef.current.filter((page) => !page.leaving);
    const top = open.at(-1);
    if (!top) return false;
    setPages((list) => list.map((page) => (page.key === top.key ? { ...page, leaving: true } : page)));
    return true;
  }, []);
  /** The top page becomes another, in place (a new chat once it is made). */
  const replace = useCallback(
    (page: P) =>
      setPages((list) => {
        const at = list.map((item) => !item.leaving).lastIndexOf(true);
        if (at < 0) return [...list, { ...page, key: `p${next++}` }];
        return list.map((item, i) => (i === at ? { ...page, key: item.key } : item));
      }),
    [],
  );
  const clear = useCallback(() => setPages([]), []);
  const gone = useCallback((key: string) => setPages((list) => list.filter((page) => page.key !== key)), []);
  const top = pages.filter((page) => !page.leaving).at(-1);
  return { pages, top, push, back, replace, clear, gone };
}

/** One page of the stack: in from the right when it opens, out to the right when it leaves. */
export function StackSlide({
  leaving,
  onGone,
  children,
}: {
  leaving?: boolean | undefined;
  onGone: () => void;
  children: React.ReactNode;
}) {
  const s = useStyles();
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(width)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [x]);
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => {
    if (!leaving) return;
    Animated.timing(x, {
      toValue: width,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: false,
    }).start(() => gone.current());
  }, [leaving, x, width]);
  return (
    <Animated.View
      pointerEvents={leaving ? "none" : "auto"}
      style={[StyleSheet.absoluteFill, s.page, { transform: [{ translateX: x }] }]}
    >
      {children}
    </Animated.View>
  );
}

const useStyles = makeStyles((theme) => ({
  page: {
    backgroundColor: theme.bg,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: -4, height: 0 },
  },
}));
