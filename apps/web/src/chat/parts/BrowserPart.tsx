import type { Agent, Part } from "@apx/protocol";
import { LiveBrowserCard } from "@apx/ui";
import { hostPath } from "../../common/format.ts";
import { useInView } from "../../common/useInView.ts";
import { useScreenshot } from "../../common/useScreenshot.ts";
import { useData } from "../../data/state.ts";
import { go } from "../../shell/nav.ts";

const REFRESH_MS = 2000;

/** "En vivo" card for a tab an agent is driving; refreshes its screenshot only while on screen. */
export function BrowserPart({ part, agent }: { part: Extract<Part, { type: "browser" }>; agent?: Agent }) {
  const tab = useData((s) => s.tabs.find((t) => t.tab === part.tab));
  const [ref, inView] = useInView<HTMLDivElement>();
  const live = part.state !== "done" && tab != null;
  const shot = useScreenshot(part.tab, REFRESH_MS, inView && live);
  const url = tab?.url ?? part.url;
  const who = agent?.name ?? "El agente";
  const status =
    part.state === "handoff"
      ? (part.reason ?? `${who} necesita que sigas vos`)
      : part.state === "user"
        ? "Tenés el control"
        : part.state === "agent"
          ? `${who} está navegando · ${hostPath(url)}`
          : tab
            ? `Terminó · ${hostPath(url)}`
            : "La pestaña se cerró";
  const open = () => go.browser(part.tab);
  return (
    <div ref={ref}>
      <LiveBrowserCard
        live={live}
        url={url}
        title={tab?.title || part.title || hostPath(url)}
        status={status}
        statusTone={part.state === "handoff" ? "warning" : "neutral"}
        thumbnail={shot.src}
        actionLabel={tab ? "Abrir en vivo" : undefined}
        onOpen={tab ? open : undefined}
        onAction={open}
      />
    </div>
  );
}
