// Whether ⌘/Ctrl or Alt is held: buttons with a shortcut show its keys only then.
import { useEffect, useState } from "react";

export function useModifierHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const update = (e: KeyboardEvent) => setHeld(e.metaKey || e.ctrlKey || e.altKey);
    const reset = () => setHeld(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return held;
}
