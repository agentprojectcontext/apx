import type { Agent, Part } from "@apx/protocol";
import { LiveBrowserCard } from "@apx/ui";
import { hostPath } from "../../common/format.ts";
import { useInView } from "../../common/useInView.ts";
import { useScreenshot } from "../../common/useScreenshot.ts";
import { browserOpen } from "../../data/actions.ts";
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
  // A tab that went away (its window, the app or the core closed it) says so whatever the agent was doing.
  const status = !tab
    ? t("browser.offline", { host })
    : part.state === "handoff"
      ? (part.reason ?? t("browser.handoff", { name }))
      : part.state === "user"
        ? t("browser.youControl")
        : part.state === "agent"
          ? t("browser.agentBrowsing", { name, host })
          : t("browser.finished", { host });
  const open = () => go.browser(part.tab);
  // A closed tab opens again on the same page.
  const reopen = async () => {
    const id = await browserOpen(url);
    if (id) go.browser(id);
  };
  return (
    <div ref={ref}>
      <LiveBrowserCard
        live={live}
        url={url}
        title={tab?.title || part.title || hostPath(url)}
        status={status}
        statusTone={tab && part.state === "handoff" ? "warning" : "neutral"}
        thumbnail={shot.src}
        liveLabel={t("browser.live")}
        actionLabel={tab ? t("browser.openLive") : t("browser.reopen")}
        onOpen={tab ? open : () => void reopen()}
        onAction={tab ? open : () => void reopen()}
      />
    </div>
  );
}
