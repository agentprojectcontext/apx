import { AgentAvatar, IconButton, Icons, Kbd, Menu } from "@apx/ui";
import { Fragment, Suspense } from "react";
import logoUrl from "../assets/logo.png";
import { useChannels } from "../data/channels.ts";
import { blobOf, findProject, projectName, secretary } from "../data/identity.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { UsageButton } from "../lazy.ts";
import { AttentionTray } from "./AttentionTray.tsx";
import { useDesktopClass } from "./desktop.ts";
import { LanguageMenu, useLanguageItems } from "./LanguageMenu.tsx";
import { go, PROJECT_TABS, useNav, useNavHistory } from "./nav.ts";
import { RunningIndicator } from "./RunningIndicator.tsx";
import { UpdatePill, WhatsNewPill } from "./UpdatePill.tsx";

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
  const crumbs = useCrumbs();
  const mode = useNav((s) => s.mode);
  const canBack = useNavHistory((s) => s.canBack);
  const canForward = useNavHistory((s) => s.canForward);
  const languageItems = useLanguageItems();
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
      <button type="button" className="topbar__search" onClick={() => go.palette(true)}>
        <Icons.Search size={14} />
        <span className="topbar__search-label">{t("topbar.search")}</span>
        <Kbd keys={["⌘", "K"]} data-shortcut-modifier />
      </button>
      <div className="topbar__right">
        <WhatsNewPill />
        <UpdatePill />
        <RunningIndicator />
        <Suspense fallback={null}>
          <UsageButton />
        </Suspense>
        <AttentionTray />
        <div className="topbar__extras">
          <IconButton
            size="sm"
            label={t("phone.open")}
            icon={<Icons.Smartphone size={14} />}
            className="topbar__icon"
            onClick={() => go.phone(true)}
          />
          <LanguageMenu className="topbar__lang" />
          <IconButton
            size="sm"
            label={mode === "dark" ? t("theme.light") : t("theme.dark")}
            icon={mode === "dark" ? <Icons.Sun size={14} /> : <Icons.Moon size={14} />}
            className="topbar__icon"
            onClick={go.toggleMode}
          />
        </div>
        {/* Narrow windows fold usage, phone, language and theme into one menu so the bar never scrolls sideways. */}
        <Menu
          align="end"
          items={[
            { label: t("sysUsage.title"), icon: <Icons.MemoryStick />, onSelect: () => go.usageDialog(true) },
            { label: t("phone.open"), icon: <Icons.Smartphone />, onSelect: () => go.phone(true) },
            {
              label: mode === "dark" ? t("theme.light") : t("theme.dark"),
              icon: mode === "dark" ? <Icons.Sun /> : <Icons.Moon />,
              onSelect: go.toggleMode,
            },
            { type: "separator" },
            ...languageItems,
          ]}
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
              <button type="button" className="topbar__agent" aria-label={sec.name}>
                <AgentAvatar name={sec.name} blob={blobOf(sec)} size={24} />
                <span className="topbar__agentname">{sec.name}</span>
                <span className="topbar__agentkbd" data-shortcut-modifier>
                  ⌘J
                </span>
              </button>
            }
          />
        )}
      </div>
    </header>
  );
}
