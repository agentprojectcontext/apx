import { AgentAvatar, IconButton, Icons, Kbd, Menu, Tooltip } from "@apx/ui";
import { Fragment, Suspense } from "react";
import logoUrl from "../assets/logo.png";
import { useChannels } from "../data/channels.ts";
import { blobOf, findProject, projectName, secretary } from "../data/identity.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { EngineUsageButton, RunningIndicator, UsageButton } from "../lazy.ts";
import { AttentionTray } from "./AttentionTray.tsx";
import { useDesktopClass } from "./desktop.ts";
import { go, PROJECT_TABS, useNav, useNavHistory } from "./nav.ts";
import { UpdatePill, WhatsNewPill } from "./UpdatePill.tsx";
import { useTopbarFit } from "./useTopbarFit.ts";

/** SPEC §1.5: Inbox / project / chat · Projects / project / tab · External sessions / engine / chat · Apps · Tasks. */
function useCrumbs(): string[] {
  const t = useT();
  const view = useNav((s) => s.view);
  const projectId = useNav((s) => s.projectId);
  const projectTab = useNav((s) => s.projectTab);
  const threadId = useNav((s) => s.threadId);
  const appId = useNav((s) => s.appId);
  const projects = useData((s) => s.projects);
  const thread = useData((s) => (threadId ? s.threads[threadId] : undefined));
  const app = useData((s) => (appId ? s.surfaces[appId] : undefined));
  const channelId = useNav((s) => s.channelId);
  const channelLabel = useChannels((s) => s.channels.find((c) => c.id === channelId)?.label);
  const engineId = useNav((s) => s.engineId);
  const engineLabel = useData((s) => s.engines.find((e) => e.id === engineId)?.label);
  if (view === "app") return [t("nav.apps"), app?.title ?? t("common.app")];
  if (view === "tasks") return [t("nav.tasks")];
  if (view === "resources") return [t("nav.resources")];
  if (view === "computers") return [t("nav.computers")];
  if (view === "channel") return [t("nav.channels"), channelLabel ?? t("nav.channels")];
  if (view === "engine") {
    const name = engineLabel ?? engineId ?? "";
    return thread ? [t("nav.externalSessions"), name, thread.title] : [t("nav.externalSessions"), name];
  }
  if (view === "project") {
    const tab = t(PROJECT_TABS.find((x) => x.id === projectTab)?.label ?? "project.tab.overview");
    return [t("nav.projects"), findProject(projects, projectId)?.name ?? t("project.fallback"), tab];
  }
  const inbox = t("nav.inbox");
  return thread ? [inbox, projectName(projects, thread.project_id), thread.title] : [inbox];
}

export function Topbar() {
  const t = useT();
  const desktop = useDesktopClass();
  const rightRef = useTopbarFit();
  const crumbs = useCrumbs();
  const canBack = useNavHistory((s) => s.canBack);
  const canForward = useNavHistory((s) => s.canForward);
  const agents = useData((s) => s.agents);
  const homeId = useData((s) => Object.values(s.threads).find((x) => x.kind === "home")?.id);
  const sec = secretary(agents);
  const folded = usePrefs((s) => s.sidebarCollapsed);
  return (
    <header className={`topbar${desktop}`}>
      <div className="topbar__left">
        <IconButton
          size="sm"
          label={folded ? t("nav.expand") : t("nav.collapse")}
          icon={folded ? <Icons.PanelLeftOpen size={15} /> : <Icons.PanelLeftClose size={15} />}
          onClick={() => setPrefs({ sidebarCollapsed: !folded })}
        />
        <div className="topbar__nav">
          <IconButton
            size="sm"
            label={t("nav.back")}
            icon={<Icons.ArrowLeft size={15} />}
            disabled={!canBack}
            onClick={go.back}
          />
          <IconButton
            size="sm"
            label={t("nav.forward")}
            icon={<Icons.ArrowRight size={15} />}
            disabled={!canForward}
            onClick={go.forward}
          />
        </div>
        <img className="topbar__logo" src={logoUrl} alt="APX" width={22} height={22} />
        <nav className="topbar__crumbs" aria-label={t("topbar.location")}>
          {crumbs.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs are positional
            <Fragment key={i}>
              {i > 0 && <span className="topbar__sep">/</span>}
              <span className={i === crumbs.length - 1 ? "topbar__crumb is-last" : "topbar__crumb"}>{c}</span>
            </Fragment>
          ))}
        </nav>
      </div>
      <Tooltip content={t("topbar.search")} side="bottom" shortcut="⌘K">
        <button
          type="button"
          className="topbar__search"
          aria-label={t("topbar.search")}
          onClick={() => go.palette(true)}
        >
          <Icons.Search size={14} />
          <span className="topbar__search-label">{t("topbar.search")}</span>
          <Kbd keys={["⌘", "K"]} data-shortcut-modifier />
        </button>
      </Tooltip>
      <div className="topbar__right" ref={rightRef}>
        <div className="topbar__activity">
          <Suspense
            fallback={
              <IconButton
                size="sm"
                className="running"
                label={t("running.label")}
                icon={<Icons.Bot size={14} />}
                disabled
              />
            }
          >
            <RunningIndicator />
          </Suspense>
          <AttentionTray />
          <WhatsNewPill />
          <UpdatePill />
        </div>
        <div className="topbar__usage">
          <Suspense
            fallback={<IconButton size="sm" label={t("engineUsage.title")} icon={<Icons.Zap size={14} />} disabled />}
          >
            <EngineUsageButton />
          </Suspense>
          <Suspense
            fallback={
              <IconButton size="sm" label={t("sysUsage.title")} icon={<Icons.MemoryStick size={14} />} disabled />
            }
          >
            <UsageButton />
          </Suspense>
        </div>
        {/* System usage remains reachable when its gauge no longer fits. */}
        <Menu
          align="end"
          items={[{ label: t("sysUsage.title"), icon: <Icons.MemoryStick />, onSelect: () => go.usageDialog(true) }]}
          trigger={
            <IconButton
              size="sm"
              label={t("topbar.more")}
              icon={<Icons.Ellipsis size={14} />}
              className="topbar__icon topbar__more"
            />
          }
        />
        {sec && (
          <Menu
            align="end"
            items={[
              {
                label: t("topbar.chatWith", { name: sec.name }),
                icon: <Icons.MessageCircle />,
                disabled: !homeId,
                onSelect: () => homeId && go.inboxThread(homeId),
              },
              {
                label: t("agent.openPanel", { name: sec.name }),
                icon: <Icons.PanelRight />,
                disabled: !homeId,
                onSelect: () => {
                  if (homeId) go.inboxThread(homeId);
                  go.agent(sec.id);
                },
              },
              { label: t("agent.super.profile"), icon: <Icons.Calendar />, onSelect: () => go.config("profile") },
              { label: t("agent.super.owner"), icon: <Icons.User />, onSelect: () => go.config("account") },
            ]}
            trigger={
              <IconButton
                className="topbar__agent"
                size="sm"
                label={sec.name}
                icon={
                  <>
                    <AgentAvatar name={sec.name} blob={blobOf(sec)} size={24} />
                    <span className="topbar__agentname">{sec.name}</span>
                    <span className="topbar__agentkbd" data-shortcut-modifier>
                      ⌘J
                    </span>
                  </>
                }
              />
            }
          />
        )}
      </div>
    </header>
  );
}
