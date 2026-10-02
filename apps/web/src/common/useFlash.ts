import { useEffect, useRef, useState } from "react";
import { nav, useNav } from "../shell/nav.ts";

const FLASH_MS = 2400;

/**
 * What a link pointed at (a notice, a deep link) is scrolled into view and lit for a moment, so the owner sees
 * where they landed. `key` names the thing ("pairing:123456"); the flash is used once.
 */
export function useFlash<T extends HTMLElement>(key: string) {
  const focus = useNav((s) => s.focus);
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (focus !== key) return;
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    setOn(true);
    nav.set({ focus: undefined });
    const off = setTimeout(() => setOn(false), FLASH_MS);
    return () => clearTimeout(off);
  }, [focus, key]);
  return { ref, flash: on };
}
