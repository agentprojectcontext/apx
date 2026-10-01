import { ApxProvider } from "@apx/ui";
import { useEffect } from "react";
import { startLive } from "./data/live.ts";
import { useNav } from "./shell/nav.ts";
import { Shell } from "./shell/Shell.tsx";

export function App() {
  const mode = useNav((s) => s.mode);
  useEffect(() => startLive(), []);
  return (
    <ApxProvider look="minimal" mode={mode} fill>
      <Shell />
    </ApxProvider>
  );
}
