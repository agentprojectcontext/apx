import type { Agent, Part } from "@apx/protocol";
import { Button, Icons, LiveBrowserCard } from "@apx/ui";
import { hostPath } from "../../common/format.ts";
import { useInView } from "../../common/useInView.ts";
import { useScreenshot } from "../../common/useScreenshot.ts";
import { browserOpen } from "../../data/actions.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go, useNav } from "../../shell/nav.ts";

const REFRESH_MS = 2000;

/** Guest links always open their computer; a tab already shown beside the chat needs no second preview. */
export function BrowserPart({
  part,
  agent,
  threadId,
}: {
  part: Extract<Part, { type: "browser" }>;
  agent?: Agent;
  threadId: string;
}) {
  const t = useT();
  const onComputer = useData((s) => s.vmThreads.includes(threadId));
  const guest = part.environment === "vm" || onComputer;
  const tab = useData((s) => (guest ? undefined : s.tabs.find((t) => t.tab === part.tab)));
  const panel = useNav((s) => s.panel);
  const currentThread = useNav((s) => s.threadId);
  const wantedTab = useNav((s) => s.browserTab);
  const activeTab = useData((s) => (s.tabs.find((t) => t.tab === wantedTab) ?? s.tabs[0])?.tab);
  const beside = guest
    ? panel === "computer" && currentThread === threadId
    : panel === "browser" && activeTab === part.tab;
  const [ref, inView] = useInView<HTMLDivElement>();
  const live = !guest && !beside && part.state !== "done" && tab != null;
  const shot = useScreenshot(part.tab, REFRESH_MS, inView && live);
  const url = tab?.url ?? part.url;
  const name = agent?.name ?? t("chat.theAgent");
  const host = hostPath(url);
  const title = tab?.title || part.title || host;
  // A tab that went away (its window, the app or the core closed it) says so whatever the agent was doing.
  const status = guest
    ? t("computer.screen")
    : !tab
      ? t("browser.offline", { host })
      : part.state === "handoff"
        ? (part.reason ?? t("browser.handoff", { name }))
        : part.state === "user"
          ? t("browser.youControl")
          : part.state === "agent"
            ? t("browser.agentBrowsing", { name, host })
            : t("browser.finished", { host });
  const open = () => (guest ? go.panel("computer") : go.browser(part.tab));
  // A closed tab opens again on the same page.
  const reopen = async () => {
    const id = await browserOpen(url);
    if (id) go.browser(id);
  };
  if (guest || beside)
    return (
      <div ref={ref}>
        <Button
          className="browserpart__compact"
          size="sm"
          variant="secondary"
          leadingIcon={guest ? <Icons.Monitor size={14} /> : <Icons.Globe size={14} />}
          title={url}
          aria-label={`${guest ? t("panel.computer") : t("browser.openLive")}: ${title}`}
          onClick={open}
        >
          {title} · {guest ? t("panel.computer") : t("browser.openLive")}
        </Button>
      </div>
    );
  return (
    <div ref={ref}>
      <LiveBrowserCard
        live={live}
        url={url}
        title={title}
        status={status}
        statusTone={tab && part.state === "handoff" ? "warning" : "neutral"}
        thumbnail={shot.src}
        liveLabel={t("browser.live")}
        actionLabel={guest ? t("panel.computer") : tab ? t("browser.openLive") : t("browser.reopen")}
        onOpen={guest || tab ? open : () => void reopen()}
        onAction={guest || tab ? open : () => void reopen()}
      />
    </div>
  );
}
