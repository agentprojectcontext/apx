import { ActivityPill } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { thinkingLine } from "./thinkingLine.ts";

/**
 * A chat's agent at work before its answer shows: how long it has been at it and, for models that say it, what it is
 * thinking now (the last part of its reasoning summary), so a long think does not read as a stuck chat.
 */
export function Thinking({ threadId, name, face }: { threadId: string; name: string; face?: ReactNode }) {
  const t = useT();
  const text = useData((s) => s.thinking[threadId]);
  const [since] = useState(Date.now);
  const [now, setNow] = useState(since);
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const secs = Math.round((now - since) / 1000);
  const label = t(text ? "chat.agentThinking" : "chat.agentWorking", { name });
  const last = thinkingLine(text);
  return (
    <div className="transcript__activity transcript__activity--thinking">
      <ActivityPill tone="brand" label={secs >= 3 ? `${label} · ${secs} s` : label} from={face} />
      {last && <p className="transcript__thinking">{last}</p>}
    </div>
  );
}
