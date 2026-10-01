import type { Agent, Part } from "@apx/protocol";
import { LiveBrowserCard } from "@apx/ui";
import { hostPath } from "../../common/format.ts";
import { useInView } from "../../common/useInView.ts";
import { useScreenshot } from "../../common/useScreenshot.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";

const REFRESH_MS = 2000;

/** "Live" card for a tab an agent is driving; refreshes its screenshot only while on screen. */
export function BrowserPart({ part, agent }: { part: Extract<Part, { type: "browser" }>; agent?: Agent }) {
  const t = useT();
  const tab = useData((s) => s.tabs.find((t) => t.tab === part.tab));
  const [ref, inView] = useInView<HTMLDivElement>();
  const live = part.state !== "done" && tab != null;
  const shot = useScreenshot(part.tab, REFRESH_MS, inView && live);
  const url = tab?.url ?? part.url;
  const name = agent?.name ?? t("chat.theAgent");
  const host = hostPath(url);
  const status =
    part.state === "handoff"
      ? (part.reason ?? t("browser.handoff", { name }))
      : part.state === "user"
        ? t("browser.youControl")
        : part.state === "agent"
          ? t("browser.agentBrowsing", { name, host })
          : tab
            ? t("browser.finished", { host })
            : t("browser.tabClosed");
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
        liveLabel={t("browser.live")}
        actionLabel={tab ? t("browser.openLive") : undefined}
        onOpen={tab ? open : undefined}
        onAction={open}
      />
    </div>
  );
}
